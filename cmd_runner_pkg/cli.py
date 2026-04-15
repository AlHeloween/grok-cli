from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .console_mode import enable_vt_modes, write_terminal_reset_to_stdout
from .inbox_bridge import InboxMessage, pump_inbox_jsonl
from .key_encode import encode_keys
from .run_layout import run_paths, runs_root
from .run_session import RunSession, StartParams
from .util import die, new_run_id, parse_key_value

_CHILD_ENV = "CMD_RUNNER__CHILD"


def _is_repo_root_cwd(cwd: Path) -> bool:
    return (cwd / "cmd_runner.py").is_file() and (cwd / "cmd_runner_pkg").is_dir()


def _is_release_bundle_cwd(cwd: Path) -> bool:
    cwd_exe = cwd / "cmd_runner.exe"
    if os.name != "nt" or not cwd_exe.is_file():
        return False
    try:
        exe = Path(sys.executable).resolve()
        return exe.name.lower() == "cmd_runner.exe" and exe == cwd_exe.resolve()
    except Exception:
        return False


def _is_installed_package_mode() -> bool:
    try:
        here = Path(__file__).resolve()
    except Exception:
        return False
    return any(part.lower() in ("site-packages", "dist-packages") for part in here.parts)


def _require_supported_cwd() -> None:
    cwd = Path.cwd()
    if _is_repo_root_cwd(cwd):
        return
    if _is_release_bundle_cwd(cwd):
        return
    if _is_installed_package_mode():
        return

    raise RuntimeError(
        "cmd_runner must be launched from a supported working directory "
        "(repo root: cwd must contain cmd_runner.py and cmd_runner_pkg/; "
        "release bundle: cwd must contain cmd_runner.exe; "
        "installed package mode: run the pipx/package console script from the target project directory)."
    )


def _print_help() -> None:
    txt = """cmd_runner — ConPTY-only interactive command runner (serverless)

COMMANDS
  start   Spawn a new window and run an interactive session there.
  tail    Print a run log for an existing run.
  list    List known runs under logs/cmd_runner/.
  status  Show state.json for a run.
  send    Append input to a run inbox.jsonl (bridge).
  stop    Request the hosting process to terminate the run (serverless).

USAGE (repo root; recommended)
  uv run cmd_runner.py start [--cwd PATH] [--env KEY=VALUE ...] [--cols N] [--rows N]
                                   [--timeout-s N] [--max-log-mb N] [--run-id ID]
                                   [--terminal conhost|wt]
                                   [--keep-open]
                                   [--] <command ...>

  uv run cmd_runner.py tail <run_id> [--follow] [--text|--stdout]
  uv run cmd_runner.py list [--limit N] [--json]
  uv run cmd_runner.py status <run_id> [--json]
  uv run cmd_runner.py send <run_id> (--text TEXT | --keys TOKENS | --hex HEX | --b64 B64) [--crlf]
  uv run cmd_runner.py stop <run_id> [--reason TEXT]

USAGE (release bundle root)
  cmd_runner.exe start [--cwd PATH] [--env KEY=VALUE ...] [--cols N] [--rows N]
                       [--timeout-s N] [--max-log-mb N] [--run-id ID]
                       [--terminal conhost|wt]
                       [--keep-open]
                       [--] <command ...>

  cmd_runner.exe tail <run_id> [--follow] [--text|--stdout]
  cmd_runner.exe list [--limit N] [--json]
  cmd_runner.exe status <run_id> [--json]
  cmd_runner.exe send <run_id> (--text TEXT | --keys TOKENS | --hex HEX | --b64 B64) [--crlf]
  cmd_runner.exe stop <run_id> [--reason TEXT]

USAGE (installed package / pipx)
  cmd_runner start [--cwd PATH] [--env KEY=VALUE ...] [--cols N] [--rows N]
                   [--timeout-s N] [--max-log-mb N] [--run-id ID]
                   [--terminal conhost|wt]
                   [--keep-open]
                   [--] <command ...>

  cmd_runner tail <run_id> [--follow] [--text|--stdout]
  cmd_runner list [--limit N] [--json]
  cmd_runner status <run_id> [--json]
  cmd_runner send <run_id> (--text TEXT | --keys TOKENS | --hex HEX | --b64 B64) [--crlf]
  cmd_runner stop <run_id> [--reason TEXT]

NOTES
  - Windows-only (requires ConPTY: Windows 10 1809+).
  - No background server, no detached workers, no TCP control plane.
  - Repo wrapper mode must be launched from the project root (cwd contains cmd_runner.py + cmd_runner_pkg/).
  - Release bundle mode must be launched from the bundle root (cwd contains cmd_runner.exe).
  - Installed package / pipx mode uses the current working directory as the run root.
  - Run logs are written under: logs/cmd_runner/<run_id>/
  - Bridge: append JSONL commands to logs/cmd_runner/<run_id>/inbox.jsonl during the run.
  - `start` opens a separate terminal window and runs cmd_runner there (so the new window is interactive).
  - `start` uses `conhost` by default (most stable) and spawns the hosting window minimized.
  - `--keep-open` keeps the hosting shell window open after the command exits (useful for debugging).
  - `tail` defaults to non-follow (prints current content and exits). Use `--follow` to stream until the run is done.

TERMINALS
  - `--terminal conhost` (default) is the most reliable for key input/editing.
  - `--terminal wt` forces a new Windows Terminal window (`wt -w new ...`).

INBOX BRIDGE (JSONL)
  - One JSON object per line in: logs/cmd_runner/<run_id>/inbox.jsonl
  - Shapes (all: add_crlf defaults to false; no implicit Enter):
    - {"text": "dir", "add_crlf": false}
    - {"data_b64": "BASE64...", "add_crlf": false}
    - {"keys": ["TEXT:/exit","ENTER"], "add_crlf": false}
  - Key tokens:
    - LEFT/RIGHT/UP/DOWN/HOME/END
    - BACKSPACE/DELETE/INSERT/TAB/ESC/ENTER
    - TEXT:<utf8>   CHAR:<c>   HEX:<hex>

STOP (serverless)
  - stop writes: logs/cmd_runner/<run_id>/stop_request.json
  - The hosting cmd_runner process watches for this file and calls TerminateJobObject.

EXAMPLES
  - Open a new window (interactive there) and print run_id + inbox path here:
    - uv run cmd_runner.py start --terminal conhost -- pwsh
  - Inject input programmatically:
    - uv run scripts/cmd_runner_inbox_send.py --run-id <run_id> --keys "TEXT:/exit,ENTER"
  - Management:
    - uv run cmd_runner.py list
    - uv run cmd_runner.py status <run_id>
    - uv run cmd_runner.py send <run_id> --keys "TEXT:/exit,ENTER"
    - uv run cmd_runner.py stop <run_id> --reason "done"
"""
    sys.stdout.write(txt)
    sys.stdout.flush()


def _split_pre_and_payload(argv: List[str]) -> Tuple[List[str], List[str], bool]:
    if "--" not in argv:
        return argv, [], False
    i = argv.index("--")
    return argv[:i], argv[i + 1 :], True


def _parse_common_opts(pre: List[str]) -> Tuple[str, Dict[str, str], int, int, Optional[int], int]:
    cwd = os.getcwd()
    env_overrides: Dict[str, str] = {}
    cols = 120
    rows = 30
    timeout_s: Optional[int] = None
    max_log_mb = 50
    i = 0
    while i < len(pre):
        tok = pre[i]
        if tok == "--cwd":
            i += 1
            if i >= len(pre):
                raise RuntimeError("--cwd requires a value")
            cwd = pre[i]
        elif tok == "--env":
            i += 1
            if i >= len(pre):
                raise RuntimeError("--env requires KEY=VALUE")
            k, v = parse_key_value(pre[i])
            env_overrides[k] = v
        elif tok == "--cols":
            i += 1
            cols = int(pre[i])
        elif tok == "--rows":
            i += 1
            rows = int(pre[i])
        elif tok == "--timeout-s":
            i += 1
            t = int(pre[i])
            timeout_s = None if t <= 0 else t
        elif tok == "--max-log-mb":
            i += 1
            max_log_mb = int(pre[i])
        else:
            raise RuntimeError(f"Unknown option: {tok}")
        i += 1

    return cwd, env_overrides, cols, rows, timeout_s, max_log_mb


def _parse_run_id_opt(pre: List[str]) -> Tuple[Optional[str], List[str]]:
    run_id: Optional[str] = None
    rest: List[str] = []
    i = 0
    while i < len(pre):
        tok = pre[i]
        if tok == "--run-id":
            i += 1
            if i >= len(pre):
                raise RuntimeError("--run-id requires a value")
            run_id = str(pre[i])
        else:
            rest.append(tok)
        i += 1
    return run_id, rest


def _split_run_opts_and_payload(tokens: List[str]) -> Tuple[Optional[str], List[str], List[str]]:
    """
    Split a run-like argv list into:
      (run_id, option_tokens, payload_argv)

    PowerShell may consume a literal `--` when invoking scripts, so `--` is optional.
    If `--` exists, everything after it is payload.
    Otherwise, parse known `--*` options until the first non-option token, which begins the payload.
    """
    if "--" in tokens:
        pre, payload, _ = _split_pre_and_payload(tokens)
        run_id, pre2 = _parse_run_id_opt(pre)
        return run_id, pre2, payload

    pre2: List[str] = []
    payload: List[str] = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok in ("--keep-open",):
            pre2.append(tok)
            i += 1
            continue
        if tok in (
            "--cwd",
            "--env",
            "--cols",
            "--rows",
            "--timeout-s",
            "--max-log-mb",
            "--run-id",
            "--terminal",
        ):
            pre2.append(tok)
            i += 1
            if i >= len(tokens):
                raise RuntimeError(f"{tok} requires a value")
            pre2.append(tokens[i])
            i += 1
            continue

        # First non-option token starts the payload argv.
        payload = tokens[i:]
        break

    run_id, pre3 = _parse_run_id_opt(pre2)
    return run_id, pre3, payload


def _parse_terminal_opt(pre: List[str]) -> Tuple[str, List[str]]:
    terminal = "conhost"
    rest: List[str] = []
    i = 0
    while i < len(pre):
        tok = pre[i]
        if tok == "--terminal":
            i += 1
            if i >= len(pre):
                raise RuntimeError("--terminal requires: conhost|wt")
            terminal = str(pre[i]).lower().strip()
            if terminal not in ("conhost", "wt"):
                raise RuntimeError("--terminal requires: conhost|wt")
        else:
            rest.append(tok)
        i += 1
    return terminal, rest


def _parse_keep_open_flag(pre: List[str]) -> Tuple[bool, List[str]]:
    keep_open = False
    rest: List[str] = []
    for tok in pre:
        if tok == "--keep-open":
            keep_open = True
        else:
            rest.append(tok)
    return keep_open, rest


def _tail_follow(path: Path, *, follow: bool, stop_evt: threading.Event) -> None:
    outb = getattr(sys.stdout, "buffer", None)
    with path.open("rb") as f:
        while True:
            if stop_evt.is_set():
                chunk = f.read()
                if chunk:
                    if outb is not None:
                        outb.write(chunk)
                        outb.flush()
                    else:
                        sys.stdout.write(chunk.decode("utf-8", errors="replace"))
                        sys.stdout.flush()
                return

            chunk = f.read(65536)
            if chunk:
                if outb is not None:
                    outb.write(chunk)
                    outb.flush()
                else:
                    sys.stdout.write(chunk.decode("utf-8", errors="replace"))
                    sys.stdout.flush()
            else:
                if not follow:
                    return
                time.sleep(0.05)


def _read_state(state_json: Path) -> Optional[Dict[str, object]]:
    if not state_json.is_file():
        return None
    try:
        obj = json.loads(state_json.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    return obj


def _pid_is_alive(pid: int) -> Optional[bool]:
    pid = int(pid)
    if pid <= 0:
        return False

    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            kernel32.GetExitCodeProcess.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL

            h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not h:
                # Not found OR no permission -> treat as unknown (do not lie).
                return None
            try:
                code = wintypes.DWORD(0)
                ok = kernel32.GetExitCodeProcess(h, ctypes.byref(code))
                if not ok:
                    return None
                return int(code.value) == STILL_ACTIVE
            finally:
                kernel32.CloseHandle(h)
        except Exception:
            return None

    # POSIX-ish (best effort).
    try:
        os.kill(pid, 0)
    except PermissionError:
        return None
    except ProcessLookupError:
        return False
    except OSError:
        return None
    else:
        return True


def _any_pid_alive(pids: object) -> Optional[bool]:
    if not isinstance(pids, list):
        return None
    ids: List[int] = []
    for p in pids:
        if isinstance(p, int):
            ids.append(int(p))
        elif isinstance(p, str) and p.strip().isdigit():
            ids.append(int(p.strip()))
    if not ids:
        return None

    saw_unknown = False
    for pid in ids:
        alive = _pid_is_alive(pid)
        if alive is True:
            return True
        if alive is None:
            saw_unknown = True
    return None if saw_unknown else False


def _derived_status(state: Dict[str, object]) -> str:
    st = str(state.get("status") or "unknown")
    if st != "running":
        return st
    alive = _any_pid_alive(state.get("pids"))
    if alive is True:
        return "running"
    if alive is False:
        # Hardware-grounded correction: logs say running, but OS says no live PIDs.
        return "lost"
    return "running?"  # unknown (cannot prove either way)


def _is_running_like(status: str) -> bool:
    return status in ("running", "running?")


def _format_text_line(raw: bytes) -> str:
    s = raw.replace(b"\x00", b"").decode("utf-8", errors="replace")
    s = s.replace("\t", " ")
    s = "".join(ch for ch in s if ch >= " ")
    s = re.sub(r" +", " ", s).strip()
    return s


def _format_stdout_line(raw: bytes) -> str:
    b = raw.replace(b"\x00", b"")
    if b.endswith(b"\r"):
        b = b[:-1]

    out: List[str] = []
    i = 0
    while i < len(b):
        cur = b[i]
        if cur == 0x20:
            j = i + 1
            while j < len(b) and b[j] == 0x20:
                j += 1
            out.append(f"[{j - i}]20")
            i = j
            continue
        if 0x21 <= cur <= 0x7E:
            out.append(chr(cur))
        else:
            out.append(f"[1]{cur:02x}")
        i += 1
    return "".join(out)


class _LineNumberingFormatter:
    def __init__(self, *, mode: str) -> None:
        if mode not in ("text", "stdout"):
            raise ValueError("mode must be: text|stdout")
        self._mode = mode
        self._buf = b""
        # Note: this is the *source* line number (1-based) in the underlying log file.
        # We may skip printing empty/whitespace-only lines, but we must still increment
        # the source line counter so printed numbers remain correlatable to raw logs.
        self._src_line_no = 1

    def feed(self, chunk: bytes) -> str:
        self._buf += chunk
        out_lines: List[str] = []
        while True:
            nl = self._buf.find(b"\n")
            if nl < 0:
                break
            raw = self._buf[:nl]
            self._buf = self._buf[nl + 1 :]
            if self._mode == "text":
                s = _format_text_line(raw)
            else:
                s = _format_stdout_line(raw)
            if s:
                out_lines.append(f"{self._src_line_no}: {s}\n")
            self._src_line_no += 1
        return "".join(out_lines)

    def flush(self) -> str:
        if not self._buf:
            return ""
        raw = self._buf
        self._buf = b""
        if self._mode == "text":
            s = _format_text_line(raw)
        else:
            s = _format_stdout_line(raw)
        if s:
            out = f"{self._src_line_no}: {s}\n"
        else:
            out = ""
        self._src_line_no += 1
        return out


def _tail_follow_formatted(
    path: Path,
    *,
    mode: str,
    follow: bool,
    state_json: Path,
    stop_evt: threading.Event,
) -> None:
    fmt = _LineNumberingFormatter(mode=mode)
    with path.open("rb") as f:
        while True:
            if stop_evt.is_set():
                rest = f.read()
                if rest:
                    sys.stdout.write(fmt.feed(rest))
                sys.stdout.write(fmt.flush())
                sys.stdout.flush()
                return

            chunk = f.read(65536)
            if chunk:
                sys.stdout.write(fmt.feed(chunk))
                sys.stdout.flush()
                continue

            if not follow:
                sys.stdout.write(fmt.flush())
                sys.stdout.flush()
                return

            state = _read_state(state_json)
            if state is not None:
                d = _derived_status(state)
                if not _is_running_like(d):
                    sys.stdout.write(fmt.flush())
                    sys.stdout.flush()
                    return

            time.sleep(0.05)


_EXT_KEY_TO_VT: Dict[bytes, bytes] = {
    b"H": b"\x1b[A",   # Up
    b"P": b"\x1b[B",   # Down
    b"M": b"\x1b[C",   # Right
    b"K": b"\x1b[D",   # Left
    b"G": b"\x1b[H",   # Home
    b"O": b"\x1b[F",   # End
    b"I": b"\x1b[5~",  # Page Up
    b"Q": b"\x1b[6~",  # Page Down
    b"R": b"\x1b[2~",  # Insert
    b"S": b"\x1b[3~",  # Delete
}


def _interactive_input_loop(session: RunSession, stop_evt: threading.Event) -> None:
    if os.name != "nt":
        return
    try:
        from .win_console_input import iter_console_input_bytes
        from .wt_win32_input import Win32InputStreamDecoder

        sys.stderr.write("[cmd_runner] input=ReadConsoleInputW\n")
        sys.stderr.flush()
        dec = Win32InputStreamDecoder()
        for data in iter_console_input_bytes(should_stop=stop_evt.is_set):
            out = dec.feed(data)
            if out:
                session.send_bytes(out, record_payload={"key": "console", "decoded": bool(dec.stats.packets_seen)})
        return
    except Exception:
        # If stdin is not a real console (common under Windows Terminal), try reading raw VT bytes from stdin pipe.
        try:
            from .win_stdin_pipe import iter_stdin_pipe_bytes
            from .wt_win32_input import Win32InputStreamDecoder

            sys.stderr.write("[cmd_runner] input=stdin_pipe(ReadFile)\n")
            sys.stderr.flush()
            dec = Win32InputStreamDecoder()
            for data in iter_stdin_pipe_bytes(should_stop=stop_evt.is_set):
                out = dec.feed(data)
                if out:
                    session.send_bytes(out, record_payload={"key": "stdin_pipe", "decoded": bool(dec.stats.packets_seen)})
            return
        except Exception:
            pass

        # Last resort: minimal msvcrt loop.
        import msvcrt

        sys.stderr.write("[cmd_runner] input=msvcrt_fallback\n")
        sys.stderr.flush()
        while not stop_evt.is_set():
            if not msvcrt.kbhit():
                time.sleep(0.02)
                continue
            b = msvcrt.getch()

            if b in (b"\x00", b"\xe0"):
                ext = msvcrt.getch()
                vt = _EXT_KEY_TO_VT.get(ext)
                if vt is not None:
                    session.send_bytes(vt, record_payload={"key": "ext", "code": int(ext[0])})
                continue

            if b == b"\r":
                session.send_bytes(b"\r", record_payload={"key": "enter"})
                continue

            session.send_bytes(b, record_payload={"key": "byte"})


def _resize_loop(session: RunSession, stop_evt: threading.Event) -> None:
    # Best-effort resize propagation for TUIs.
    last: Optional[Tuple[int, int]] = None
    while not stop_evt.is_set():
        try:
            sz = os.get_terminal_size()
            cur = (int(sz.columns), int(sz.lines))
        except OSError:
            time.sleep(0.25)
            continue

        if last != cur:
            try:
                session.resize(cur[0], cur[1])
            except Exception:
                # Resize is best-effort; do not crash the run on resize failures.
                pass
            last = cur
        time.sleep(0.2)


def _cmd_tail(argv: List[str]) -> int:
    _require_supported_cwd()
    if not argv:
        raise RuntimeError("tail requires <run_id>")
    run_id = argv[0]
    follow = False  # default: non-follow (avoid freeze when run already completed)
    mode = "text"
    rest = argv[1:]
    for tok in rest:
        if tok == "--follow":
            follow = True
        elif tok == "--no-follow":
            follow = False
        elif tok == "--text":
            mode = "text"
        elif tok == "--stdout":
            mode = "stdout"
        else:
            raise RuntimeError("tail supports only: [--follow|--no-follow] [--text|--stdout]")

    paths = run_paths(run_id)
    src = paths.stdout_text_log if mode == "text" else paths.stdout_log
    if not src.is_file():
        return die(f"Unknown run_id (missing {src})", 2)

    stop_evt = threading.Event()
    _tail_follow_formatted(
        src,
        mode=mode,
        follow=follow,
        state_json=paths.state_json,
        stop_evt=stop_evt,
    )
    return 0


def _cmd_list(argv: List[str]) -> int:
    _require_supported_cwd()
    limit = 50
    as_json = False
    i = 0
    while i < len(argv):
        tok = argv[i]
        if tok == "--limit":
            i += 1
            if i >= len(argv):
                raise RuntimeError("--limit requires a value")
            limit = int(argv[i])
        elif tok == "--json":
            as_json = True
        else:
            raise RuntimeError(f"Unknown option for list: {tok}")
        i += 1

    root = runs_root()
    if not root.exists():
        runs: List[str] = []
    else:
        runs = [p.name for p in root.iterdir() if p.is_dir()]
    runs.sort(reverse=True)
    if limit > 0:
        runs = runs[:limit]

    if not as_json:
        lines: List[str] = []
        for run_id in runs:
            paths = run_paths(run_id)
            status = "unknown"
            exit_code: object = "-"
            started: object = "-"
            finished: object = "-"
            if paths.state_json.is_file():
                try:
                    state = json.loads(paths.state_json.read_text(encoding="utf-8", errors="replace"))
                    if isinstance(state, dict):
                        status = _derived_status(state)
                    if state.get("exit_code") is not None:
                        exit_code = state.get("exit_code")
                    if state.get("started_utc") is not None:
                        started = state.get("started_utc")
                    if state.get("finished_utc") is not None:
                        finished = state.get("finished_utc")
                except Exception:
                    status = "state_error"
            lines.append(
                f"run_id={run_id} status={status} exit_code={exit_code} started_utc={started} finished_utc={finished}"
            )
        sys.stdout.write("\n".join(lines) + ("\n" if lines else ""))
        return 0

    rows: List[Dict[str, object]] = []
    for run_id in runs:
        d = root / run_id
        state_p = d / "state.json"
        rec: Dict[str, object] = {"run_id": run_id}
        if state_p.exists():
            try:
                rec["state"] = json.loads(state_p.read_text(encoding="utf-8", errors="replace"))
            except Exception as e:
                rec["state_error"] = str(e)
        rows.append(rec)
    sys.stdout.write(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
    return 0


def _cmd_status(argv: List[str]) -> int:
    _require_supported_cwd()
    if not argv:
        raise RuntimeError("status requires <run_id>")
    run_id = argv[0]
    as_json = False
    rest = argv[1:]
    if rest:
        if rest == ["--json"]:
            as_json = True
        else:
            raise RuntimeError("status supports only: [--json]")

    paths = run_paths(run_id)
    if not paths.state_json.is_file():
        return die(f"Unknown run_id (missing {paths.state_json})", 2)
    txt = paths.state_json.read_text(encoding="utf-8", errors="replace")
    if as_json:
        sys.stdout.write(txt.rstrip() + "\n")
        return 0

    try:
        state = json.loads(txt)
    except Exception:
        sys.stdout.write(txt.rstrip() + "\n")
        return 0

    status: object
    if isinstance(state, dict):
        status = _derived_status(state)
    else:
        status = None

    meta: Dict[str, object] = {}
    if paths.meta_json.is_file():
        try:
            meta = json.loads(paths.meta_json.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            meta = {}

    sys.stdout.write(
        f"run_id={run_id} status={status if status is not None else (state.get('status') if isinstance(state, dict) else None)} "
        f"exit_code={state.get('exit_code') if isinstance(state, dict) else None} "
        f"started_utc={state.get('started_utc') if isinstance(state, dict) else None} "
        f"finished_utc={state.get('finished_utc') if isinstance(state, dict) else None} "
        f"cwd={meta.get('cwd')} argv={meta.get('argv')}\n"
    )
    return 0


def _cmd_send(argv: List[str]) -> int:
    _require_supported_cwd()
    if len(argv) < 3:
        raise RuntimeError("send requires: send <run_id> (--text TEXT | --keys TOKENS | --hex HEX | --b64 B64) [--crlf]")
    run_id = argv[0]
    rest = argv[1:]

    add_crlf = False
    msg: Dict[str, object] = {}

    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--crlf":
            add_crlf = True
        elif tok == "--text":
            i += 1
            if i >= len(rest):
                raise RuntimeError("--text requires a value")
            msg = {"text": rest[i]}
        elif tok == "--keys":
            i += 1
            if i >= len(rest):
                raise RuntimeError("--keys requires a value")
            raw = rest[i]
            toks = [t.strip() for t in raw.split(",") if t.strip()]
            msg = {"keys": toks}
        elif tok == "--hex":
            i += 1
            if i >= len(rest):
                raise RuntimeError("--hex requires a value")
            hx = rest[i].strip().replace(" ", "")
            data = bytes.fromhex(hx)
            msg = {"data_b64": base64.b64encode(data).decode("ascii")}
        elif tok == "--b64":
            i += 1
            if i >= len(rest):
                raise RuntimeError("--b64 requires a value")
            msg = {"data_b64": rest[i]}
        else:
            raise RuntimeError(f"Unknown option for send: {tok}")
        i += 1

    if not msg:
        raise RuntimeError("send requires one of: --text/--keys/--hex/--b64")
    msg["add_crlf"] = bool(add_crlf)

    paths = run_paths(run_id)
    if not paths.inbox_jsonl.is_file():
        return die(f"Unknown run_id (missing {paths.inbox_jsonl})", 2)
    line = json.dumps(msg, ensure_ascii=False) + "\n"
    paths.inbox_jsonl.open("ab").write(line.encode("utf-8"))
    return 0


def _cmd_stop(argv: List[str]) -> int:
    _require_supported_cwd()
    if not argv:
        raise RuntimeError("stop requires <run_id>")
    run_id = argv[0]
    reason: Optional[str] = None
    rest = argv[1:]
    if rest:
        if len(rest) == 2 and rest[0] == "--reason":
            reason = rest[1]
        else:
            raise RuntimeError("stop supports only: stop <run_id> [--reason TEXT]")

    paths = run_paths(run_id)
    if not paths.run_dir.is_dir():
        return die(f"Unknown run_id (missing {paths.run_dir})", 2)

    payload: Dict[str, object] = {
        "run_id": run_id,
        "requested_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if reason is not None:
        payload["reason"] = reason
    paths.stop_request_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sys.stdout.write(f"stop requested: {paths.stop_request_json}\n")
    return 0


def _cmd_host(pre: List[str], payload: List[str], *, had_double_dash: bool) -> int:
    if os.name != "nt":
        return die("cmd_runner is Windows-only (ConPTY).", 2)
    _require_supported_cwd()
    if not payload:
        raise RuntimeError("start requires a command argv")

    forced_run_id, pre2 = _parse_run_id_opt(pre)
    cwd, env_overrides, cols, rows, timeout_s, max_log_mb = _parse_common_opts(pre2)
    terminal_host = env_overrides.pop("CMD_RUNNER__LAUNCH_TERMINAL", None)
    params = StartParams(
        argv=payload,
        cwd=cwd,
        env_overrides=env_overrides,
        cols=cols,
        rows=rows,
        timeout_s=timeout_s,
        max_log_mb=max_log_mb,
        low_priority=True,
        terminal_host=str(terminal_host) if terminal_host else None,
    )

    runs_root().mkdir(parents=True, exist_ok=True)

    def _write_console(chunk: bytes) -> None:
        outb = getattr(sys.stdout, "buffer", None)
        if outb is not None:
            outb.write(chunk)
            outb.flush()
        else:
            sys.stdout.write(chunk.decode("utf-8", errors="replace"))
            sys.stdout.flush()

    session = RunSession(params, on_output=_write_console, run_id=forced_run_id)
    with enable_vt_modes():
        session.start()

        stop_evt = threading.Event()
        bridge_stop_evt = threading.Event()

        # Best-effort: if the hosting console window is closed, attempt to stop the child and persist state.json.
        # This is not guaranteed (hard kills can still prevent flushing), but it improves hardware-grounded status.
        if os.name == "nt":
            try:
                import ctypes
                from ctypes import wintypes

                kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
                HANDLER = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)
                CTRL_CLOSE_EVENT = 2
                CTRL_LOGOFF_EVENT = 5
                CTRL_SHUTDOWN_EVENT = 6

                close_once = {"done": False}

                def _on_ctrl(ctrl_type: int) -> int:
                    if int(ctrl_type) not in (CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT):
                        return 0
                    if close_once["done"]:
                        return 1
                    close_once["done"] = True
                    try:
                        sys.stderr.write("[cmd_runner] console close detected; stopping run...\n")
                        sys.stderr.flush()
                    except Exception:
                        pass
                    try:
                        session.stop(reason="console_closed")
                    except Exception:
                        pass
                    try:
                        stop_evt.set()
                        bridge_stop_evt.set()
                    except Exception:
                        pass
                    return 1

                # Keep a reference so the callback is not GC'd.
                _ctrl_handler = HANDLER(_on_ctrl)  # noqa: F841
                kernel32.SetConsoleCtrlHandler(_ctrl_handler, True)
            except Exception:
                pass
        t_in = threading.Thread(
            target=_interactive_input_loop,
            args=(session, stop_evt),
            name=f"cmd_runner-in-{session.run_id}",
            daemon=True,
        )
        t_resize = threading.Thread(
            target=_resize_loop,
            args=(session, stop_evt),
            name=f"cmd_runner-resize-{session.run_id}",
            daemon=True,
        )

        def _send_inbox(msg: InboxMessage, meta: Dict[str, object]) -> None:
            if msg.data is not None:
                session.send_bytes(msg.data, record_payload={"bridge": "inbox", **meta})
                if msg.add_crlf:
                    session.send_bytes(b"\r\n", record_payload={"bridge": "inbox", "synthetic": "crlf", **meta})
                return
            if msg.keys is not None:
                vt = session.vt_mode_snapshot()
                enc = encode_keys(msg.keys, vt=vt)
                session.send_bytes(enc.data, record_payload={"bridge": "inbox", "keys": enc.keys, **meta})
                if msg.add_crlf:
                    session.send_bytes(b"\r\n", record_payload={"bridge": "inbox", "synthetic": "crlf", **meta})
                return
            if msg.text is not None:
                data = msg.text.encode("utf-8", errors="replace")
                session.send_bytes(data, record_payload={"bridge": "inbox", "text": msg.text, **meta})
                if msg.add_crlf:
                    session.send_bytes(b"\r\n", record_payload={"bridge": "inbox", "synthetic": "crlf", **meta})
                return
            raise RuntimeError("Invalid inbox message: no data/text/keys")

        def _bridge_loop() -> None:
            pump_inbox_jsonl(
                session.paths.inbox_jsonl,
                send_message=_send_inbox,
                should_stop=bridge_stop_evt.is_set,
                on_error=lambda msg: sys.stderr.write(f"[cmd_runner bridge] {msg}\n"),
            )

        t_bridge = threading.Thread(
            target=_bridge_loop,
            name=f"cmd_runner-bridge-{session.run_id}",
            daemon=True,
        )

        sys.stderr.write(f"[cmd_runner] run_id={session.run_id} inbox={session.paths.inbox_jsonl}\n")
        sys.stderr.flush()

        t_in.start()
        t_resize.start()
        t_bridge.start()

        try:
            session.wait_done()
        except KeyboardInterrupt:
            session.stop(reason="keyboard_interrupt")
            session.wait_done()
        finally:
            stop_evt.set()
            bridge_stop_evt.set()
            t_in.join(timeout=1.0)
            t_resize.join(timeout=1.0)
            t_bridge.join(timeout=1.0)

    snap = session.get_state_snapshot()
    code = snap.get("exit_code")
    sys.stderr.write(f"[cmd_runner] finished run_id={session.run_id} exit_code={code}\n")
    sys.stderr.flush()
    write_terminal_reset_to_stdout()
    return int(code) if isinstance(code, int) else 1


def _spawn_new_window(argv: List[str], *, cwd: Path, terminal: str, env: Optional[Dict[str, str]] = None) -> None:
    """
    Spawn a new terminal window for interactive cmd_runner hosting.

    `conhost` is the most stable for key input and is the default when --terminal is not specified.
    By default, the spawned window is minimized.
    """
    if os.name != "nt":
        raise RuntimeError("start is Windows-only")

    if terminal == "wt":
        wt = shutil.which("wt.exe") or shutil.which("wt")
        if not wt:
            raise RuntimeError("Requested --terminal wt but wt.exe was not found on PATH")
        # -w new ensures a separate window (not just a new tab).
        cmd = [wt, "-w", "new", "-d", str(cwd)] + argv
        subprocess.Popen(cmd, cwd=str(cwd), env=env)
        return

    # conhost/default: spawn a new console window minimized (no cmd.exe wrapping; avoids cmd parsing issues).
    creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
    startupinfo = None
    try:
        # Available on Windows; ignored elsewhere.
        si = subprocess.STARTUPINFO()
        si.dwFlags |= getattr(subprocess, "STARTF_USESHOWWINDOW", 0)
        # SW_SHOWMINNOACTIVE = 7 (minimized, does not activate).
        si.wShowWindow = 7
        startupinfo = si
    except Exception:
        startupinfo = None

    subprocess.Popen(
        argv,
        cwd=str(cwd),
        env=env,
        startupinfo=startupinfo,
        creationflags=creationflags,
    )


def _cmd_start(pre: List[str], payload: List[str], *, had_double_dash: bool) -> int:
    if os.name != "nt":
        return die("cmd_runner start is Windows-only.", 2)
    _require_supported_cwd()
    if not payload:
        raise RuntimeError("start requires a command argv")

    forced_run_id, pre2 = _parse_run_id_opt(pre)
    terminal, pre3 = _parse_terminal_opt(pre2)
    keep_open, pre4 = _parse_keep_open_flag(pre3)
    cwd, env_overrides, cols, rows, timeout_s, max_log_mb = _parse_common_opts(pre4)

    # Child mode: host the ConPTY session in the current terminal window.
    if os.environ.get(_CHILD_ENV, "").strip() == "1":
        # keep_open is only meaningful for the parent shell; ignore it here.
        _ = keep_open
        return _cmd_host(pre, payload, had_double_dash=had_double_dash)

    # Parent mode: spawn a new terminal window which runs this same command in child mode.
    run_id = forced_run_id or new_run_id()
    root = Path.cwd()
    inbox = root / "logs" / "cmd_runner" / run_id / "inbox.jsonl"

    if Path(sys.executable).name.lower() == "cmd_runner.exe":
        argv: List[str] = [str(Path(sys.executable)), "start"]
    elif _is_repo_root_cwd(root):
        argv = [str(Path(sys.executable)), str(root / "cmd_runner.py"), "start"]
    elif _is_installed_package_mode():
        argv = [str(Path(sys.executable)), "-m", "cmd_runner_pkg", "start"]
    else:
        argv = [str(Path(sys.executable)), str(root / "cmd_runner.py"), "start"]

    argv += [
        "--run-id",
        run_id,
        "--cwd",
        cwd,
        "--cols",
        str(cols),
        "--rows",
        str(rows),
        "--max-log-mb",
        str(max_log_mb),
    ]
    if timeout_s is not None:
        argv += ["--timeout-s", str(timeout_s)]
    argv += ["--env", f"CMD_RUNNER__LAUNCH_TERMINAL={terminal}"]
    for k, v in env_overrides.items():
        if k == "CMD_RUNNER__LAUNCH_TERMINAL":
            raise RuntimeError("Reserved env var name used: CMD_RUNNER__LAUNCH_TERMINAL")
        argv += ["--env", f"{k}={v}"]
    argv += ["--"] + payload

    spawn_env = dict(os.environ)
    spawn_env[_CHILD_ENV] = "1"

    if keep_open:
        argv = ["cmd.exe", "/k", subprocess.list2cmdline(argv)]

    _spawn_new_window(argv, cwd=root, terminal=terminal, env=spawn_env)

    sys.stdout.write(f"{run_id}\n")
    sys.stdout.write(f"inbox={inbox}\n")
    sys.stdout.flush()
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)

    if not argv or argv[0] in ("--help", "-h", "help"):
        _print_help()
        return 0

    cmd = argv[0]
    rest = argv[1:]

    try:
        if cmd == "start":
            run_id, pre, payload = _split_run_opts_and_payload(rest)
            if run_id is not None:
                pre = ["--run-id", run_id] + pre
            return _cmd_start(pre, payload, had_double_dash=True)

        if cmd == "tail":
            pre, payload, had = _split_pre_and_payload(rest)
            if had:
                raise RuntimeError("tail does not accept -- payload")
            if pre:
                return _cmd_tail(pre)
            return _cmd_tail(payload)

        if cmd == "list":
            pre, payload, had = _split_pre_and_payload(rest)
            if had:
                raise RuntimeError("list does not accept -- payload")
            if payload:
                raise RuntimeError("list does not accept positional args")
            return _cmd_list(pre)

        if cmd == "status":
            pre, payload, had = _split_pre_and_payload(rest)
            if had:
                raise RuntimeError("status does not accept -- payload")
            return _cmd_status(pre + payload)

        if cmd == "send":
            pre, payload, had = _split_pre_and_payload(rest)
            if had:
                raise RuntimeError("send does not accept -- payload")
            return _cmd_send(pre + payload)

        if cmd == "stop":
            pre, payload, had = _split_pre_and_payload(rest)
            if had:
                raise RuntimeError("stop does not accept -- payload")
            return _cmd_stop(pre + payload)

        raise RuntimeError(f"Unknown command: {cmd}")
    except Exception as e:
        return die(str(e), 2)
