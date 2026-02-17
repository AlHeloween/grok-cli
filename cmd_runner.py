#!/usr/bin/env python3
"""cmd_runner

Purpose (Exact):
- Start a command as a task and run it in a separate minimized interactive window on Windows.
- Persist logs + machine-readable state so an agent can tail safe-obfuscated output.

Design (Exact):
- No optional switches that change observability or window behavior.
"""

from __future__ import annotations

import argparse
import codecs
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_RUNS_REL = Path("logs") / "cmd_runner"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_iso_z(dt: datetime | None = None) -> str:
    d = dt or _utc_now()
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _utc_stamp() -> str:
    return _utc_now().strftime("%Y-%m-%dT%H-%M-%SZ")


def _slugify(parts: list[str]) -> str:
    s = "_".join([p for p in parts if p]).strip("_")
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s)
    s = re.sub(r"_+", "_", s)
    return (s[:80] or "run").strip("_")


def runs_root() -> Path:
    return (Path.cwd() / _RUNS_REL).resolve()


def _legacy_runs_root() -> Path:
    return runs_root() / "runs"


def run_dir(run_id: str) -> Path:
    p = runs_root() / run_id
    if p.exists():
        return p
    legacy = _legacy_runs_root() / run_id
    if legacy.exists():
        return legacy
    return p


def _meta_path(run_id: str) -> Path:
    return run_dir(run_id) / "meta.json"


def _state_path(run_id: str) -> Path:
    return run_dir(run_id) / "state.json"


def _stdout_path(run_id: str) -> Path:
    return run_dir(run_id) / "stdout.log"


def _stderr_path(run_id: str) -> Path:
    return run_dir(run_id) / "stderr.log"


def _cmd_rc_path(run_id: str) -> Path:
    return run_dir(run_id) / "cmd_exit_code.txt"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8", errors="replace"))


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _parse_command(argv: list[str]) -> list[str]:
    out = list(argv)
    while out and out[0] == "--":
        out = out[1:]
    return out


_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def obfuscate(text: str) -> str:
    s = _ANSI_RE.sub("", text)
    out: list[str] = []
    for ch in s:
        o = ord(ch)
        if ch in ("\n", "\r", "\t"):
            out.append(ch)
        elif 32 <= o <= 126:
            out.append(ch)
        else:
            out.append("?")
    return "".join(out)


def _safe_u32_hex(rc: int) -> str:
    return f"0x{(rc & 0xFFFFFFFF):08x}"


def _tail(path: Path, lines: int) -> str:
    if lines <= 0 or not path.exists():
        return ""
    data = b""
    chunk = 8192
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        pos = f.tell()
        while pos > 0 and data.count(b"\n") <= lines:
            read_sz = chunk if pos >= chunk else pos
            pos -= read_sz
            f.seek(pos)
            data = f.read(read_sz) + data
            if pos == 0:
                break
    parts = data.splitlines()[-lines:]
    return "\n".join(p.decode("utf-8", errors="replace") for p in parts) + ("\n" if parts else "")


def _ps_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def _ps_invocation(cmd: list[str]) -> str:
    if not cmd:
        return "exit 1"
    return "& " + " ".join([_ps_quote(cmd[0])] + [_ps_quote(a) for a in cmd[1:]])


def _pwsh_exe() -> str:
    if os.name != "nt":
        return "pwsh"
    for name in ("pwsh.exe", "powershell.exe"):
        p = shutil.which(name)
        if p:
            return p
    return "powershell.exe"


def _bash_exe() -> str:
    p = shutil.which("bash")
    return p or "bash"


def _python_for_detached_worker() -> str:
    python = sys.executable
    if os.name != "nt":
        return python
    exe = Path(python)
    if exe.name.lower() == "python.exe":
        pyw = exe.with_name("pythonw.exe")
        if pyw.exists():
            return str(pyw)
    return python


def _pid_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            cp = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            return str(pid) in (cp.stdout or "")
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def _kill_pid_tree(pid: int, force: bool) -> None:
    if pid <= 0:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return

    try:
        import signal

        os.killpg(pid, signal.SIGKILL if force else signal.SIGTERM)
    except Exception:
        return


def _parse_env_kv(items: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in items:
        if not item or "=" not in item:
            continue
        k, v = item.split("=", 1)
        k = k.strip()
        if not k:
            continue
        out[k] = v
    return out


def cmd_send(ns: argparse.Namespace) -> int:
    rd = run_dir(ns.run_id)
    if not rd.exists():
        print("not found")
        return 1

    if os.name != "nt":
        print("send: Windows-only")
        return 2

    sp = _state_path(ns.run_id)
    if not sp.exists():
        print("not found")
        return 1
    state = _read_json(sp)
    pid_val = state.get("child_pid")
    pid = int(pid_val) if isinstance(pid_val, int) else None
    if pid is None:
        print("send_failed")
        return 3

    text = str(ns.text or "")
    if bool(ns.escapes):
        try:
            text = codecs.decode(text, "unicode_escape")
        except Exception:
            pass

    delay_ms = int(ns.delay_ms) if ns.delay_ms is not None else 0
    ok = _win_console_inject(pid=pid, text=text, enter=bool(ns.enter), delay_ms=delay_ms)
    print("sent" if ok else "send_failed")
    return 0 if ok else 3


def _win_console_inject(*, pid: int, text: str, enter: bool, delay_ms: int) -> bool:
    python = _python_for_detached_worker()
    args = [
        python,
        str(Path(__file__).resolve()),
        "_send_console_input",
        "--pid",
        str(int(pid)),
        "--text",
        text,
    ]
    if enter:
        args.append("--enter")
    if delay_ms and delay_ms > 0:
        args += ["--delay-ms", str(int(delay_ms))]

    popen_kwargs: dict[str, Any] = {}
    creationflags = 0
    creationflags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    creationflags |= getattr(subprocess, "DETACHED_PROCESS", 0)
    creationflags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
    popen_kwargs["creationflags"] = creationflags
    popen_kwargs["close_fds"] = True

    cp = subprocess.run(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **popen_kwargs,
    )
    return cp.returncode == 0


def cmd__send_console_input(ns: argparse.Namespace) -> int:
    if os.name != "nt":
        return 2

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    FreeConsole = kernel32.FreeConsole
    FreeConsole.argtypes = []
    FreeConsole.restype = wintypes.BOOL

    AttachConsole = kernel32.AttachConsole
    AttachConsole.argtypes = [wintypes.DWORD]
    AttachConsole.restype = wintypes.BOOL

    CreateFileW = kernel32.CreateFileW
    CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    CreateFileW.restype = wintypes.HANDLE

    WriteConsoleInputW = kernel32.WriteConsoleInputW
    WriteConsoleInputW.argtypes = [
        wintypes.HANDLE,
        wintypes.LPVOID,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    WriteConsoleInputW.restype = wintypes.BOOL

    CloseHandle = kernel32.CloseHandle
    CloseHandle.argtypes = [wintypes.HANDLE]
    CloseHandle.restype = wintypes.BOOL

    VkKeyScanW = user32.VkKeyScanW
    VkKeyScanW.argtypes = [wintypes.WCHAR]
    VkKeyScanW.restype = wintypes.SHORT

    MapVirtualKeyW = user32.MapVirtualKeyW
    MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
    MapVirtualKeyW.restype = wintypes.UINT

    MAPVK_VK_TO_VSC = 0
    VK_RETURN = 0x0D
    KEY_EVENT = 0x0001

    SHIFT_PRESSED = 0x0010
    LEFT_CTRL_PRESSED = 0x0008
    RIGHT_ALT_PRESSED = 0x0001

    class CHAR_UNION(ctypes.Union):
        _fields_ = [("UnicodeChar", wintypes.WCHAR), ("AsciiChar", wintypes.CHAR)]

    class KEY_EVENT_RECORD(ctypes.Structure):
        _fields_ = [
            ("bKeyDown", wintypes.BOOL),
            ("wRepeatCount", wintypes.WORD),
            ("wVirtualKeyCode", wintypes.WORD),
            ("wVirtualScanCode", wintypes.WORD),
            ("uChar", CHAR_UNION),
            ("dwControlKeyState", wintypes.DWORD),
        ]

    class EVENT_UNION(ctypes.Union):
        _fields_ = [("KeyEvent", KEY_EVENT_RECORD)]

    class INPUT_RECORD(ctypes.Structure):
        _fields_ = [("EventType", wintypes.WORD), ("Event", EVENT_UNION)]

    try:
        FreeConsole()
    except Exception:
        pass

    if not bool(AttachConsole(int(ns.pid))):
        return 3

    GENERIC_WRITE = 0x40000000
    FILE_SHARE_READ = 0x00000001
    FILE_SHARE_WRITE = 0x00000002
    OPEN_EXISTING = 3

    h_conin = CreateFileW(
        "CONIN$",
        GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        None,
        OPEN_EXISTING,
        0,
        None,
    )
    if not h_conin or int(h_conin) == -1:
        return 4

    def _write_char(ch: str) -> bool:
        vk = 0
        scan = 0
        control_state = 0

        if ch == "\r":
            vk = VK_RETURN
            scan = int(MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)) & 0xFFFF
            u = CHAR_UNION(UnicodeChar="\r")
        else:
            mapped = int(VkKeyScanW(ch))
            if mapped != -1:
                vk = mapped & 0xFF
                shift_state = (mapped >> 8) & 0xFF
                if shift_state & 0x01:
                    control_state |= SHIFT_PRESSED
                if shift_state & 0x02:
                    control_state |= LEFT_CTRL_PRESSED
                if shift_state & 0x04:
                    control_state |= RIGHT_ALT_PRESSED
                scan = int(MapVirtualKeyW(vk, MAPVK_VK_TO_VSC)) & 0xFFFF
            u = CHAR_UNION(UnicodeChar=ch)

        rec_down = INPUT_RECORD()
        rec_down.EventType = KEY_EVENT
        rec_down.Event.KeyEvent = KEY_EVENT_RECORD(True, 1, int(vk), int(scan), u, int(control_state))

        rec_up = INPUT_RECORD()
        rec_up.EventType = KEY_EVENT
        rec_up.Event.KeyEvent = KEY_EVENT_RECORD(False, 1, int(vk), int(scan), u, int(control_state))

        buf = (INPUT_RECORD * 2)(rec_down, rec_up)
        written = wintypes.DWORD(0)
        ok = bool(WriteConsoleInputW(h_conin, ctypes.byref(buf), 2, ctypes.byref(written)))
        return ok and int(written.value) == 2

    delay = int(ns.delay_ms) if ns.delay_ms is not None else 0
    for ch in str(ns.text or ""):
        if not _write_char(ch):
            try:
                CloseHandle(h_conin)
            except Exception:
                pass
            return 5
        if delay and delay > 0:
            time.sleep(float(delay) / 1000.0)

    if bool(ns.enter):
        _write_char("\r")

    try:
        CloseHandle(h_conin)
    except Exception:
        pass

    return 0


def cmd_start(ns: argparse.Namespace) -> int:
    cmd = _parse_command(ns.command)
    if not cmd:
        print("Missing command. Usage: cmd_runner.py start -- <cmd...>")
        return 1

    rr = runs_root()
    rr.mkdir(parents=True, exist_ok=True)

    run_id = f"{_utc_stamp()}_{_slugify([Path(cmd[0]).name] + cmd[1:3])}"
    rd = run_dir(run_id)
    rd.mkdir(parents=True, exist_ok=True)

    created = _utc_iso_z()
    meta = {
        "run_id": run_id,
        "created_utc": created,
        "cwd": str(Path(ns.cwd).resolve() if ns.cwd else Path.cwd()),
        "cmd": cmd,
        "timeout_s": ns.timeout_s,
        "env": _parse_env_kv(ns.env),
    }
    _write_json(_meta_path(run_id), meta)

    state = {
        "run_id": run_id,
        "state": "starting",
        "updated_utc": created,
        "worker_pid": None,
        "child_pid": None,
        "cmd_done": False,
        "cmd_returncode_raw": None,
        "cmd_returncode_u32_hex": None,
        "cmd_done_utc": None,
        "returncode_raw": None,
        "returncode_u32_hex": None,
    }
    _write_json(_state_path(run_id), state)

    python = _python_for_detached_worker()
    worker_argv: list[str] = [python, str(Path(__file__).resolve()), "_run", "--run-id", run_id]
    if ns.cwd:
        worker_argv += ["--cwd", ns.cwd]
    if ns.timeout_s is not None:
        worker_argv += ["--timeout-s", str(ns.timeout_s)]
    worker_argv += ["--", *cmd]

    popen_kwargs: dict[str, Any] = {}
    if os.name == "nt":
        creationflags = 0
        creationflags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        creationflags |= getattr(subprocess, "DETACHED_PROCESS", 0)
        creationflags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
        popen_kwargs["creationflags"] = creationflags
        popen_kwargs["close_fds"] = True
    else:
        popen_kwargs["start_new_session"] = True

    worker = subprocess.Popen(
        worker_argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **popen_kwargs,
    )

    state["worker_pid"] = worker.pid
    state["updated_utc"] = _utc_iso_z()
    _write_json(_state_path(run_id), state)

    print(run_id)
    return 0


def _run_non_windows(cmd: list[str], cwd: Path, env: dict[str, str], outp: Path, errp: Path, timeout_s: float | None) -> tuple[str, int]:
    bash = _bash_exe()
    cmd_str = " ".join(shlex.quote(x) for x in cmd)
    wrapped = [bash, "-lc", cmd_str]

    with open(outp, "wb") as out_f, open(errp, "wb") as err_f:
        child = subprocess.Popen(
            wrapped,
            cwd=str(cwd),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=out_f,
            stderr=err_f,
            start_new_session=True,
        )

        deadline = time.time() + timeout_s if timeout_s is not None else None
        while True:
            if deadline is not None and time.time() > deadline:
                _kill_pid_tree(child.pid, force=True)
                try:
                    child.wait(timeout=5)
                except Exception:
                    pass
                return "timeout_killed", 1
            try:
                rc = child.wait(timeout=0.25)
                return "finished", int(rc)
            except subprocess.TimeoutExpired:
                continue


def cmd__run(ns: argparse.Namespace) -> int:
    run_id = ns.run_id
    mp = _meta_path(run_id)
    sp = _state_path(run_id)
    if not mp.exists() or not sp.exists():
        return 1

    meta = _read_json(mp)
    cmd: list[str] = list(meta.get("cmd") or [])
    if ns.command:
        cmd = _parse_command(ns.command)
    if not cmd:
        return 1

    cwd = Path(ns.cwd).resolve() if ns.cwd else Path(str(meta.get("cwd") or Path.cwd()))
    timeout_s_val = ns.timeout_s if ns.timeout_s is not None else meta.get("timeout_s")
    timeout_s = float(timeout_s_val) if timeout_s_val is not None else None

    env = os.environ.copy()
    for k, v in (meta.get("env") or {}).items():
        if isinstance(k, str) and isinstance(v, str):
            env[k] = v

    state = _read_json(sp)
    state.update({"state": "running", "updated_utc": _utc_iso_z(), "worker_pid": os.getpid()})
    _write_json(sp, state)

    rd = run_dir(run_id)
    rd.mkdir(parents=True, exist_ok=True)

    outp = _stdout_path(run_id)
    errp = _stderr_path(run_id)
    cmd_rc_path = _cmd_rc_path(run_id)

    if os.name != "nt":
        finished_state, rc = _run_non_windows(cmd=cmd, cwd=cwd, env=env, outp=outp, errp=errp, timeout_s=timeout_s)
        cmd_rc_path.write_text(str(int(rc)), encoding="utf-8", errors="replace")
        state.update(
            {
                "cmd_done": True,
                "cmd_returncode_raw": int(rc),
                "cmd_returncode_u32_hex": _safe_u32_hex(int(rc)),
                "cmd_done_utc": _utc_iso_z(),
                "state": finished_state,
                "returncode_raw": int(rc),
                "returncode_u32_hex": _safe_u32_hex(int(rc)),
                "updated_utc": _utc_iso_z(),
            }
        )
        _write_json(sp, state)
        return 0

    pwsh = _pwsh_exe()
    ps1_path = rd / "task_window.ps1"

    inv = _ps_invocation(cmd)

    ps1_lines: list[str] = [
    "$ErrorActionPreference = 'Continue'",
    "$ProgressPreference = 'SilentlyContinue'",
    "chcp 65001 | Out-Null",
    "[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new()",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
    "$OutputEncoding = [Console]::OutputEncoding",
    f"$host.ui.RawUI.WindowTitle = 'cmd_runner {run_id}'",
    f"Set-Location -LiteralPath {_ps_quote(str(cwd))}",
    f"$logPath = {_ps_quote(str(outp))}",
    f"$cmdRcPath = {_ps_quote(str(cmd_rc_path))}",
    "Remove-Item -LiteralPath $logPath -ErrorAction SilentlyContinue",
    "try {",
    "  Start-Transcript -LiteralPath $logPath -Force | Out-Null",
    f"  {inv}",
    "  $rc = $LASTEXITCODE",
    "  Set-Content -LiteralPath $cmdRcPath -Value $rc -Encoding Ascii",
    "  Write-Host ('cmd_runner: cmd_exit_code=' + $rc)",
    "  exit 0",
    "} finally {",
    "  try { Stop-Transcript | Out-Null } catch {}",
    "}",
]

    ps1_path.write_text("\n".join(ps1_lines) + "\n", encoding="utf-8", errors="replace")

    errp.write_text("cmd_runner: stderr is captured in stdout.log\n", encoding="utf-8", errors="replace")

    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
    popen_kwargs: dict[str, Any] = {"creationflags": creationflags}

    try:
        si = subprocess.STARTUPINFO()
        si.dwFlags |= getattr(subprocess, "STARTF_USESHOWWINDOW", 0x00000001)
        si.wShowWindow = 7
        popen_kwargs["startupinfo"] = si
    except Exception:
        pass

    child = subprocess.Popen(
        [pwsh, "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps1_path)],
        cwd=str(cwd),
        env=env,
        **popen_kwargs,
    )

    state["child_pid"] = child.pid
    state["updated_utc"] = _utc_iso_z()
    _write_json(sp, state)

    deadline = time.time() + timeout_s if timeout_s is not None else None
    finished_state = "finished"
    rc = 0

    while True:
        if not bool(state.get("cmd_done")) and cmd_rc_path.exists():
            try:
                raw = cmd_rc_path.read_text(encoding="utf-8", errors="replace").strip()
                cmd_rc = int(raw)
                state["cmd_done"] = True
                state["cmd_returncode_raw"] = cmd_rc
                state["cmd_returncode_u32_hex"] = _safe_u32_hex(cmd_rc)
                state["cmd_done_utc"] = _utc_iso_z()
                state["state"] = "awaiting_close"
                state["updated_utc"] = _utc_iso_z()
                _write_json(sp, state)
            except Exception:
                pass

        if deadline is not None and time.time() > deadline:
            _kill_pid_tree(child.pid, force=True)
            finished_state = "timeout_killed"
            try:
                rc = child.wait(timeout=5)
            except Exception:
                rc = 1
            break

        try:
            rc = child.wait(timeout=0.25)
            finished_state = "finished"
            break
        except subprocess.TimeoutExpired:
            continue

    state = _read_json(sp)
    state.update(
        {
            "state": finished_state,
            "returncode_raw": int(rc),
            "returncode_u32_hex": _safe_u32_hex(int(rc)),
            "updated_utc": _utc_iso_z(),
        }
    )
    _write_json(sp, state)
    return 0


def cmd_tail(ns: argparse.Namespace) -> int:
    txt = _tail(_stdout_path(ns.run_id), int(ns.lines))
    if not ns.raw:
        txt = obfuscate(txt)
    sys.stdout.write(txt)
    return 0


def cmd_wait(ns: argparse.Namespace) -> int:
    deadline = time.time() + float(ns.timeout_s) if ns.timeout_s is not None else None
    while True:
        sp = _state_path(ns.run_id)
        if not sp.exists():
            print("not found")
            return 1
        state = _read_json(sp)
        st = str(state.get("state") or "")
        if bool(state.get("cmd_done")):
            print("cmd_done")
            return 0
        if st in ("finished", "timeout_killed", "issue"):
            print(st)
            return 0
        if deadline is not None and time.time() > deadline:
            print("wait_timeout")
            return 2
        time.sleep(0.25)


def cmd_stop(ns: argparse.Namespace) -> int:
    sp = _state_path(ns.run_id)
    if not sp.exists():
        print("not found")
        return 1
    state = _read_json(sp)
    pid = state.get("child_pid")
    if not isinstance(pid, int):
        print("no child pid")
        return 1
    _kill_pid_tree(pid, force=bool(ns.force))
    print("stopped")
    return 0


def cmd_killall(ns: argparse.Namespace) -> int:
    rr = runs_root()
    if not rr.exists():
        return 0
    killed = 0
    for rd in sorted([p for p in rr.iterdir() if p.is_dir()], reverse=True):
        sp = rd / "state.json"
        if not sp.exists():
            continue
        state = _read_json(sp)
        pid = state.get("child_pid")
        if not isinstance(pid, int):
            continue
        if _pid_exists(pid):
            _kill_pid_tree(pid, force=bool(ns.force))
            killed += 1
    print(f"killed={killed}")
    return 0


@dataclass(frozen=True)
class _Row:
    run_id: str
    created_utc: str
    cwd: str
    cmd: list[str]
    state: str
    child_pid: int | None
    timeout_s: int | None
    cmd_done: bool
    cmd_rc: int | None


def _parse_created_utc(s: str) -> datetime | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _load_row(run_id: str) -> _Row | None:
    mp = _meta_path(run_id)
    sp = _state_path(run_id)
    if not mp.exists() or not sp.exists():
        return None
    meta = _read_json(mp)
    state = _read_json(sp)

    cmd = list(meta.get("cmd") or [])
    timeout_s_val = meta.get("timeout_s")
    timeout_s = int(timeout_s_val) if timeout_s_val is not None else None

    child_pid = state.get("child_pid")
    if not isinstance(child_pid, int):
        child_pid = None

    cmd_rc_val = state.get("cmd_returncode_raw")
    cmd_rc = int(cmd_rc_val) if cmd_rc_val is not None else None

    return _Row(
        run_id=run_id,
        created_utc=str(meta.get("created_utc") or ""),
        cwd=str(meta.get("cwd") or ""),
        cmd=cmd,
        state=str(state.get("state") or ""),
        child_pid=child_pid,
        timeout_s=timeout_s,
        cmd_done=bool(state.get("cmd_done")),
        cmd_rc=cmd_rc,
    )


def _print_row(r: _Row, now: datetime) -> None:
    running = bool(r.child_pid is not None and _pid_exists(r.child_pid))

    created_dt = _parse_created_utc(r.created_utc)
    if r.timeout_s is None:
        left = "permanent"
    elif created_dt is None:
        left = "?"
    else:
        left_s = int((created_dt.timestamp() + float(r.timeout_s)) - now.timestamp())
        left = str(max(0, left_s))

    if r.cmd_done:
        status = "ok" if (r.cmd_rc == 0) else "issue"
    else:
        status = "running" if running else "issue"

    cmd_json = json.dumps(r.cmd, ensure_ascii=False)
    pid_s = str(r.child_pid) if r.child_pid is not None else "-"
    cmd_done_s = "1" if r.cmd_done else "0"
    cmd_rc_s = str(r.cmd_rc) if r.cmd_rc is not None else "-"

    print(
        f"{r.created_utc}\t{r.run_id}\t{status}\tleft_s={left}\tcmd_done={cmd_done_s}\tcmd_rc={cmd_rc_s}\tpid={pid_s}\tcwd={json.dumps(r.cwd)}\tcmd={cmd_json}"
    )


def cmd_list(ns: argparse.Namespace) -> int:
    rr = runs_root()
    if not rr.exists():
        return 0

    rows: list[_Row] = []
    for rd in rr.iterdir():
        if not rd.is_dir():
            continue
        r = _load_row(rd.name)
        if r is not None:
            rows.append(r)

    rows.sort(key=lambda r: r.created_utc, reverse=True)
    rows = rows[: max(0, int(ns.limit))]

    now = _utc_now()
    for r in rows:
        _print_row(r, now)

    return 0


def cmd_status(ns: argparse.Namespace) -> int:
    rr = runs_root()
    if not rr.exists():
        return 0

    rows: list[_Row] = []
    for rd in rr.iterdir():
        if not rd.is_dir():
            continue
        r = _load_row(rd.name)
        if r is None:
            continue
        if r.child_pid is None:
            continue
        if _pid_exists(r.child_pid):
            rows.append(r)

    rows.sort(key=lambda r: r.created_utc, reverse=True)
    rows = rows[: max(0, int(ns.limit))]

    now = _utc_now()
    for r in rows:
        _print_row(r, now)

    return 0


def _epilog() -> str:
    return (
        "Examples:\n"
        "  cmd_runner.py start --timeout-s 900 -- <COMMAND>\n"
        "  cmd_runner.py status [--limit 20]\n"
        "  cmd_runner.py tail <run_id> [-n 80] [--raw]\n"
        "  cmd_runner.py wait <run_id> [--timeout-s 900]\n"
        "  cmd_runner.py stop <run_id> [--force]\n"
        "  cmd_runner.py killall [--force]\n"
        "  cmd_runner.py list [--limit 20]\n"
    )


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="cmd_runner",
        add_help=True,
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=_epilog(),
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_start = sub.add_parser("start", help="Start a command in background; prints run_id")
    p_start.add_argument("--cwd", default=None)
    p_start.add_argument("--timeout-s", type=int, default=None)
    p_start.add_argument(
        "--env",
        action="append",
        default=[],
        help="Environment override KEY=VALUE (repeatable).",
    )
    p_start.add_argument("command", nargs=argparse.REMAINDER)
    p_start.set_defaults(func=cmd_start); p_send = sub.add_parser("send", help="Send keystrokes to a running session (Windows)"); p_send.add_argument("run_id"); p_send.add_argument("--text", required=True, help="Text to send as keystrokes."); p_send.add_argument("--enter", action="store_true", help="Append Enter (CR) after text."); p_send.add_argument("--delay-ms", type=int, default=None, help="Delay per character (helps slow UIs)."); p_send.add_argument("--escapes", action="store_true", help="Interpret C-style escapes in --text (e.g. \\\\n, \\\\x1b)."); p_send.set_defaults(func=cmd_send)

    p_status = sub.add_parser("status", help="List active runs")
    p_status.add_argument("--limit", type=int, default=20)
    p_status.set_defaults(func=cmd_status)

    p_tail = sub.add_parser("tail", help="Print last lines from stdout.log (obfuscated by default)")
    p_tail.add_argument("run_id")
    p_tail.add_argument("-n", "--lines", type=int, default=50)
    p_tail.add_argument("--raw", action="store_true")
    p_tail.set_defaults(func=cmd_tail)

    p_wait = sub.add_parser("wait", help="Wait for command completion (cmd_done)")
    p_wait.add_argument("run_id")
    p_wait.add_argument("--timeout-s", type=int, default=None)
    p_wait.set_defaults(func=cmd_wait)

    p_stop = sub.add_parser("stop", help="Stop a run by run_id (kills process tree)")
    p_stop.add_argument("run_id")
    p_stop.add_argument("--force", action="store_true")
    p_stop.set_defaults(func=cmd_stop)

    p_killall = sub.add_parser("killall", help="Stop all running runs (kills process trees)")
    p_killall.add_argument("--force", action="store_true")
    p_killall.set_defaults(func=cmd_killall)

    p_list = sub.add_parser("list", help="List recent runs")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.set_defaults(func=cmd_list)

    p_run = sub.add_parser("_run", help="Internal worker")
    p_run.add_argument("--run-id", required=True)
    p_run.add_argument("--cwd", default=None)
    p_run.add_argument("--timeout-s", type=int, default=None)
    p_run.add_argument("command", nargs=argparse.REMAINDER)
    p_run.set_defaults(func=cmd__run); p_send_console = sub.add_parser("_send_console_input", help="Internal helper: inject keys into a Windows console"); p_send_console.add_argument("--pid", required=True, type=int); p_send_console.add_argument("--text", required=True); p_send_console.add_argument("--enter", action="store_true"); p_send_console.add_argument("--delay-ms", type=int, default=None); p_send_console.set_defaults(func=cmd__send_console_input)

    return ap


def main() -> int:
    ap = build_parser()
    ns = ap.parse_args()
    fn = getattr(ns, "func", None)
    if fn is None:
        ap.print_help()
        return 2
    return int(fn(ns))


if __name__ == "__main__":
    raise SystemExit(main())

# ADID_ROLLBACK (from adm.exe)
# SDID_ROLLBACK {
#   "target_file": "D:\\zPython\\grok-cli\\cmd_runner.py"
#   "update_script": "adm.exe"
#   "backup_path": "D:\\zPython\\grok-cli\\cmd_runner.py.backup_20260217T072924_980975"
#   "created_at": "2026-02-16T23:29:25.006222+00:00"
#   "backup_hash": "21feed72d2082ccc94866ce8c4af06fb"
#   "new_hash": "21feed72d2082ccc94866ce8c4af06fb"
#   "goal_id": "cmd_runner_newline_between_blocks"
#   "semantics": ""
#   "update_attrs": {"relative_path": "cmd_runner.py", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "return 0def cmd_start(ns: argparse.Namespace) -> int:", "replace_present": true}
#   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\cmd_runner.py\""
# }
