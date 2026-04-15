from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from .ansi_strip import AnsiStripper
from .run_layout import RunPaths, create_run_dir_and_files, write_meta, write_state
from .util import is_windows, new_run_id, utc_now_iso
from .vt_mode import VtModeSnapshot, VtModeTracker

_INTERNAL_ENV_KEYS = (
    "CMD_RUNNER__CHILD",
    "CMD_RUNNER__LAUNCH_TERMINAL",
)


@dataclass(frozen=True)
class StartParams:
    argv: List[str]
    cwd: str
    env_overrides: Dict[str, str]
    cols: int
    rows: int
    timeout_s: Optional[int]
    max_log_mb: int
    low_priority: bool
    terminal_host: Optional[str]


class RunSession:
    def __init__(
        self,
        params: StartParams,
        *,
        on_output: Optional[Callable[[bytes], None]] = None,
        run_id: Optional[str] = None,
    ) -> None:
        self.run_id = str(run_id) if run_id else new_run_id()
        self.paths: RunPaths = create_run_dir_and_files(self.run_id)

        self._params = params
        self._on_output = on_output
        self._created_utc = utc_now_iso()

        self._lock = threading.Lock()
        self._status: str = "running"
        self._started_utc: Optional[str] = None
        self._finished_utc: Optional[str] = None
        self._stopped_utc: Optional[str] = None
        self._timeout_utc: Optional[str] = None
        self._exit_code: Optional[int] = None
        self._pids: List[int] = []

        self._log_limit_bytes: int = int(params.max_log_mb) * 1024 * 1024
        self._log_bytes_written: int = 0
        self._log_bytes_dropped: int = 0
        self._log_truncated: bool = False

        self._backend_name: str = "windows-conpty" if is_windows() else "unsupported"
        self._backend = None

        self._stdout_f = self.paths.stdout_log.open("ab", buffering=0)
        self._stdout_text_f = self.paths.stdout_text_log.open("ab", buffering=0)
        self._stripper = AnsiStripper()
        # Keep stderr.log as a created empty file only; PTY output is merged.
        self._in_f = self.paths.in_log.open("ab", buffering=0)
        self._vt_mode = VtModeTracker()

        self._done_evt = threading.Event()
        self._exit_evt = threading.Event()
        self._io_done_evt = threading.Event()
        self._stop_requested = threading.Event()

        # Meta is immutable: write exactly once here.
        write_meta(
            self.paths,
            created_utc=self._created_utc,
            cwd=params.cwd,
            argv=params.argv,
            env_overrides=params.env_overrides,
            backend=self._backend_name,
            cols=params.cols,
            rows=params.rows,
            timeout_s=params.timeout_s,
            max_log_mb=params.max_log_mb,
            terminal_host=params.terminal_host,
        )

        if params.terminal_host:
            try:
                (self.paths.run_dir / "launch_host.txt").write_text(
                    f"terminal={params.terminal_host}\n",
                    encoding="utf-8",
                )
            except Exception:
                pass

        # Create initial live state.
        self._write_state(notes="created")


    def start(self) -> None:
        # Do not leak cmd_runner control env vars into the payload process tree.
        env = dict(os.environ)
        for key in _INTERNAL_ENV_KEYS:
            env.pop(key, None)
        env.update(self._params.env_overrides)

        if not is_windows():
            raise RuntimeError("cmd_runner ConPTY sessions are supported on Windows only.")

        from .kernels.windows_conpty import WindowsConPTYSession

        self._backend = WindowsConPTYSession(
            argv=self._params.argv,
            cwd=self._params.cwd,
            env=env,
            cols=self._params.cols,
            rows=self._params.rows,
            low_priority=self._params.low_priority,
        )
        handles = self._backend.start()
        self._backend_name = "windows-conpty"
        self._pids = [int(handles.pid)]

        self._started_utc = utc_now_iso()
        self._write_state(notes="started")

        t_io = threading.Thread(target=self._io_loop, name=f"cmd_runner-io-{self.run_id}", daemon=True)
        t_wait = threading.Thread(target=self._wait_loop, name=f"cmd_runner-wait-{self.run_id}", daemon=True)
        t_stop = threading.Thread(target=self._stop_request_loop, name=f"cmd_runner-stop-{self.run_id}", daemon=True)
        t_io.start()
        t_wait.start()
        t_stop.start()


    def wait_done(self) -> None:
        self._done_evt.wait()


    def get_state_snapshot(self) -> Dict[str, object]:
        with self._lock:
            return {
                "run_id": self.run_id,
                "status": self._status,
                "pids": list(self._pids),
                "exit_code": self._exit_code,
                "started_utc": self._started_utc,
                "finished_utc": self._finished_utc,
                "stopped_utc": self._stopped_utc,
                "timeout_utc": self._timeout_utc,
                "backend": self._backend_name,
                "log": {
                    "limit_bytes": self._log_limit_bytes,
                    "bytes_written": self._log_bytes_written,
                    "bytes_dropped": self._log_bytes_dropped,
                    "truncated": self._log_truncated,
                },
            }


    def send_text(self, text: str, *, add_crlf: bool) -> int:
        data = text.encode("utf-8", errors="replace")
        if add_crlf:
            data += b"\r\n"
        return self.send_bytes(data, record_payload={"text": text, "add_crlf": add_crlf})

    def vt_mode_snapshot(self) -> VtModeSnapshot:
        return self._vt_mode.snapshot()


    def send_bytes(self, data: bytes, record_payload: Dict[str, object]) -> int:
        if self._backend is None:
            raise RuntimeError("Run is not started")
        if self._done_evt.is_set():
            return 0

        n = self._backend.write(data)

        rec = dict(record_payload)
        rec["ts_utc"] = utc_now_iso()
        rec["bytes"] = len(data)
        self._in_f.write((json.dumps(rec, ensure_ascii=False) + "\n").encode("utf-8"))
        return n


    def resize(self, cols: int, rows: int) -> None:
        if self._backend is None:
            return
        resize_fn = getattr(self._backend, "resize", None)
        if callable(resize_fn):
            resize_fn(int(cols), int(rows))


    def stop(self, *, reason: Optional[str] = None) -> None:
        if self._backend is None:
            return
        self._stop_requested.set()
        with self._lock:
            if self._status != "running":
                return
            self._status = "stopped"
            self._stopped_utc = utc_now_iso()
        note = "stop requested" if not reason else f"stop requested: {reason}"
        self._write_state(notes=note)
        self._backend.terminate_tree()

    def _stop_request_loop(self) -> None:
        """
        Watch for an out-of-process stop request file.

        This enables a serverless management command:
          cmd_runner.py stop <run_id>
        """
        while not self._done_evt.is_set():
            if self._stop_requested.is_set():
                return
            try:
                if self.paths.stop_request_json.exists():
                    self.stop()
                    return
            except Exception as e:
                self._write_state(notes=f"stop_request watch error: {e}")
            time.sleep(0.1)


    def _wait_loop(self) -> None:
        assert self._backend is not None
        timeout = None if self._params.timeout_s in (None, 0) else float(self._params.timeout_s)

        code = self._backend.wait(timeout)
        if code is None:
            # Timeout
            with self._lock:
                if self._status == "running":
                    self._status = "timeout"
                    self._timeout_utc = utc_now_iso()
            self._write_state(notes="timeout")
            self._backend.terminate_tree()
            code = self._backend.wait(None)
        elif self._stop_requested.is_set() or self._status == "stopped":
            # Explicit stop: ensure the whole tree is gone.
            try:
                self._backend.terminate_tree()
            except Exception as e:
                self._write_state(notes=f"terminate_tree error: {e}")

        with self._lock:
            self._exit_code = int(code) if code is not None else 1
            if self._status == "running":
                self._status = "finished"
            self._finished_utc = utc_now_iso()
        self._exit_evt.set()

        # For ConPTY, closing the pseudoconsole can flush/terminate conhost and let the IO loop
        # drain remaining output. Keep pipes open until backend.close().
        try:
            close_pcon = getattr(self._backend, "close_pseudoconsole", None)
            if callable(close_pcon):
                close_pcon()
        except Exception as e:
            self._write_state(notes=f"close_pseudoconsole error: {e}")

        self._write_state(notes="finished")

        # Convenience file.
        self.paths.exit_code_txt.write_text(str(self._exit_code), encoding="utf-8")

        try:
            # Give the IO loop a brief chance to drain any remaining output before closing handles.
            self._io_done_evt.wait(timeout=1.0)
            self._backend.close()
        finally:
            self._stdout_f.close()
            self._stdout_text_f.close()
            self._in_f.close()
            self._done_evt.set()


    def _io_loop(self) -> None:
        assert self._backend is not None
        empty_since: Optional[float] = None
        while not self._done_evt.is_set():
            try:
                chunk = self._backend.read(65536)
            except Exception as e:
                # No silent failure: persist diagnostic into state.json.
                self._write_state(notes=f"io read error: {e}")
                self._io_done_evt.set()
                return

            if chunk == b"":
                if self._exit_evt.is_set():
                    now = time.time()
                    if empty_since is None:
                        empty_since = now
                    # After process exit, treat a short empty window as "drained".
                    if (now - empty_since) >= 0.25:
                        self._io_done_evt.set()
                        return
                time.sleep(0.05)
                continue
            empty_since = None

            # Track VT modes (for correct key injection) from the child's output stream.
            try:
                self._vt_mode.feed(chunk)
            except Exception as e:
                self._write_state(notes=f"vt_mode.feed error: {e}")

            if self._on_output is not None:
                try:
                    self._on_output(chunk)
                except Exception as e:
                    self._write_state(notes=f"on_output error: {e}")

            truncated_now = False
            with self._lock:
                if not self._log_truncated:
                    remaining = self._log_limit_bytes - self._log_bytes_written
                    if remaining <= 0:
                        self._log_truncated = True
                        self._log_bytes_dropped += len(chunk)
                        truncated_now = True
                    elif len(chunk) <= remaining:
                        self._stdout_f.write(chunk)
                        self._log_bytes_written += len(chunk)
                    else:
                        self._stdout_f.write(chunk[:remaining])
                        self._log_bytes_written += remaining
                        self._log_bytes_dropped += len(chunk) - remaining
                        self._log_truncated = True
                        truncated_now = True
                else:
                    self._log_bytes_dropped += len(chunk)

            # Best-effort human-readable stripped log (not size-limited; intended for debugging).
            try:
                text = self._stripper.feed(chunk)
                if text:
                    self._stdout_text_f.write(text.encode("utf-8", errors="replace"))
            except Exception as e:
                self._write_state(notes=f"stdout_text_log error: {e}")

            if truncated_now:
                self._write_state(notes="log truncated by --max-log-mb")
        self._io_done_evt.set()


    def _write_state(self, notes: Optional[str]) -> None:
        snap = self.get_state_snapshot()
        write_state(
            self.paths,
            status=str(snap["status"]),
            pids=[int(x) for x in snap["pids"]],  # type: ignore[arg-type]
            exit_code=snap["exit_code"] if snap["exit_code"] is None else int(snap["exit_code"]),  # type: ignore[index]
            started_utc=snap["started_utc"],  # type: ignore[arg-type]
            finished_utc=snap["finished_utc"],  # type: ignore[arg-type]
            stopped_utc=snap["stopped_utc"],  # type: ignore[arg-type]
            timeout_utc=snap["timeout_utc"],  # type: ignore[arg-type]
            log_limit_bytes=int(snap["log"]["limit_bytes"]),  # type: ignore[index]
            log_bytes_written=int(snap["log"]["bytes_written"]),  # type: ignore[index]
            log_bytes_dropped=int(snap["log"]["bytes_dropped"]),  # type: ignore[index]
            log_truncated=bool(snap["log"]["truncated"]),  # type: ignore[index]
            backend=str(snap["backend"]),
            notes=notes,
        )
