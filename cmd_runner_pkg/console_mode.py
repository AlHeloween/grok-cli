from __future__ import annotations

import contextlib
import os
from dataclasses import dataclass
from typing import Iterator, Optional, Tuple


@dataclass(frozen=True)
class ConsoleModes:
    stdin_mode: Optional[int]
    stdout_mode: Optional[int]


def _is_windows() -> bool:
    return os.name == "nt"


@contextlib.contextmanager
def enable_vt_modes() -> Iterator[ConsoleModes]:
    """
    Best-effort: enable VT processing on stdout.

    This function is intentionally defensive:
    - If the process is not attached to a real console, it becomes a no-op.
    - It restores the original modes on exit.
    """

    if not _is_windows():
        yield ConsoleModes(stdin_mode=None, stdout_mode=None)
        return

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    GetStdHandle = kernel32.GetStdHandle
    GetStdHandle.argtypes = [wintypes.DWORD]
    GetStdHandle.restype = wintypes.HANDLE

    GetConsoleMode = kernel32.GetConsoleMode
    GetConsoleMode.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    GetConsoleMode.restype = wintypes.BOOL

    SetConsoleMode = kernel32.SetConsoleMode
    SetConsoleMode.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    SetConsoleMode.restype = wintypes.BOOL

    STD_INPUT_HANDLE = wintypes.DWORD(-10 & 0xFFFFFFFF)
    STD_OUTPUT_HANDLE = wintypes.DWORD(-11 & 0xFFFFFFFF)

    ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
    DISABLE_NEWLINE_AUTO_RETURN = 0x0008

    def _get_mode(h: int) -> Optional[int]:
        mode = wintypes.DWORD(0)
        ok = GetConsoleMode(wintypes.HANDLE(h), ctypes.byref(mode))
        return int(mode.value) if ok else None

    def _set_mode(h: int, mode: int) -> bool:
        ok = SetConsoleMode(wintypes.HANDLE(h), wintypes.DWORD(mode))
        return bool(ok)

    h_in = int(GetStdHandle(STD_INPUT_HANDLE))
    h_out = int(GetStdHandle(STD_OUTPUT_HANDLE))

    old_in = _get_mode(h_in)
    old_out = _get_mode(h_out)

    # If either handle isn't a console, treat as no-op for that stream.
    try:
        if old_out is not None:
            new_out = int(old_out) | ENABLE_VIRTUAL_TERMINAL_PROCESSING | DISABLE_NEWLINE_AUTO_RETURN
            _set_mode(h_out, new_out)

        yield ConsoleModes(stdin_mode=old_in, stdout_mode=old_out)
    finally:
        if old_out is not None:
            _set_mode(h_out, int(old_out))
        if old_in is not None:
            _set_mode(h_in, int(old_in))

        # Best-effort: flush any buffered console input events so the outer shell
        # doesn't get "stuck" after raw input forwarding.
        try:
            FlushConsoleInputBuffer = kernel32.FlushConsoleInputBuffer
            FlushConsoleInputBuffer.argtypes = [wintypes.HANDLE]
            FlushConsoleInputBuffer.restype = wintypes.BOOL
            FlushConsoleInputBuffer(wintypes.HANDLE(h_in))
        except Exception:
            pass


def write_terminal_reset_to_stdout() -> None:
    """
    Best-effort terminal reset for interactive apps that leave the screen/cursor in a bad state.
    """
    if os.name != "nt":
        return
    seq = (
        b"\x1b[0m"         # reset attributes
        b"\x1b[?25h"       # show cursor
        b"\x1b[?9001l"     # Windows Terminal win32-input-mode off (prevents [13;..._ style sequences)
        b"\x1b[?1000l"     # mouse off
        b"\x1b[?1004l"     # focus off
        b"\x1b[?2004l"     # bracketed paste off
        b"\x1b[?1049l"     # alt screen off
    )
    outb = getattr(__import__("sys").stdout, "buffer", None)
    if outb is not None:
        outb.write(seq)
        outb.flush()
    else:
        __import__("sys").stdout.write(seq.decode("utf-8", errors="ignore"))
        __import__("sys").stdout.flush()
