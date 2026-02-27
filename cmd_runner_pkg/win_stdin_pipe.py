from __future__ import annotations

import os
import time
from typing import Callable, Iterator, Optional


if os.name != "nt":
    raise RuntimeError("win_stdin_pipe imported on non-Windows")


import ctypes
from ctypes import wintypes


kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

ReadFile = kernel32.ReadFile
ReadFile.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
ReadFile.restype = wintypes.BOOL


def _winerr(msg: str) -> RuntimeError:
    err = ctypes.get_last_error()
    return RuntimeError(f"{msg} (WinError={err})")


def iter_stdin_pipe_bytes(
    *,
    should_stop: Optional[Callable[[], bool]] = None,
    poll_interval_s: float = 0.02,
    max_bytes: int = 65536,
) -> Iterator[bytes]:
    """
    Read raw bytes from stdin when stdin is a pipe (e.g. Windows Terminal hosting via ConPTY).

    This is useful because ReadConsoleInputW requires a real console input handle; when stdin is
    a pipe, the terminal typically already emits VT sequences (ESC [ A etc.) and we can forward
    them as-is into the child ConPTY stdin.
    """
    import sys

    # Note: stdin may be an anonymous pipe when running under Windows Terminal/ConPTY.
    # Do not rely on PeekNamedPipe; it can fail or return 0 in some ConPTY setups.
    #
    # Blocking ReadFile is acceptable here because this iterator runs in a daemon thread.
    import msvcrt
    h_in = int(msvcrt.get_osfhandle(sys.stdin.fileno()))
    if h_in in (0, -1):
        raise RuntimeError("stdin handle is invalid")

    while True:
        if should_stop is not None and should_stop():
            return
        buf = ctypes.create_string_buffer(int(max_bytes))
        read_n = wintypes.DWORD(0)
        ok = ReadFile(wintypes.HANDLE(h_in), buf, int(max_bytes), ctypes.byref(read_n), None)
        if not ok:
            err = ctypes.get_last_error()
            # Broken pipe / invalid handle: treat as EOF.
            if err in (109, 6, 232):  # ERROR_BROKEN_PIPE / ERROR_INVALID_HANDLE / ERROR_NO_DATA
                return
            raise _winerr("ReadFile(stdin) failed")

        n = int(read_n.value)
        if n <= 0:
            time.sleep(poll_interval_s)
            continue
        yield bytes(buf.raw[:n])
