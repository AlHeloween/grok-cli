from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Callable, Dict, Iterator, Optional, Tuple

from .util import require


if os.name != "nt":
    raise RuntimeError("win_console_input imported on non-Windows")


import ctypes
from ctypes import wintypes


kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


STD_INPUT_HANDLE = wintypes.DWORD(-10 & 0xFFFFFFFF)
INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value


class KEY_EVENT_RECORD(ctypes.Structure):
    _fields_ = [
        ("bKeyDown", wintypes.BOOL),
        ("wRepeatCount", wintypes.WORD),
        ("wVirtualKeyCode", wintypes.WORD),
        ("wVirtualScanCode", wintypes.WORD),
        ("uChar", wintypes.WCHAR),
        ("dwControlKeyState", wintypes.DWORD),
    ]


class INPUT_RECORD(ctypes.Structure):
    _fields_ = [
        ("EventType", wintypes.WORD),
        ("_padding", wintypes.WORD),
        ("KeyEvent", KEY_EVENT_RECORD),
    ]


GetStdHandle = kernel32.GetStdHandle
GetStdHandle.argtypes = [wintypes.DWORD]
GetStdHandle.restype = wintypes.HANDLE

GetConsoleMode = kernel32.GetConsoleMode
GetConsoleMode.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
GetConsoleMode.restype = wintypes.BOOL

GetNumberOfConsoleInputEvents = kernel32.GetNumberOfConsoleInputEvents
GetNumberOfConsoleInputEvents.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
GetNumberOfConsoleInputEvents.restype = wintypes.BOOL

ReadConsoleInputW = kernel32.ReadConsoleInputW
ReadConsoleInputW.argtypes = [wintypes.HANDLE, ctypes.POINTER(INPUT_RECORD), wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
ReadConsoleInputW.restype = wintypes.BOOL


KEY_EVENT = 0x0001

VK_BACK = 0x08
VK_TAB = 0x09
VK_RETURN = 0x0D
VK_ESCAPE = 0x1B
VK_SPACE = 0x20
VK_DELETE = 0x2E

VK_LEFT = 0x25
VK_UP = 0x26
VK_RIGHT = 0x27
VK_DOWN = 0x28
VK_HOME = 0x24
VK_END = 0x23
VK_INSERT = 0x2D
VK_PRIOR = 0x21  # Page Up
VK_NEXT = 0x22   # Page Down

VK_F1 = 0x70
VK_F12 = 0x7B

VK_A = 0x41
VK_Z = 0x5A

LEFT_ALT_PRESSED = 0x0002
RIGHT_ALT_PRESSED = 0x0001
LEFT_CTRL_PRESSED = 0x0008
RIGHT_CTRL_PRESSED = 0x0004
SHIFT_PRESSED = 0x0010


_SPECIAL_KEY_CSI: Dict[int, bytes] = {
    VK_UP: b"\x1b[A",
    VK_DOWN: b"\x1b[B",
    VK_RIGHT: b"\x1b[C",
    VK_LEFT: b"\x1b[D",
    VK_HOME: b"\x1b[H",
    VK_END: b"\x1b[F",
    VK_INSERT: b"\x1b[2~",
    VK_DELETE: b"\x1b[3~",
    VK_PRIOR: b"\x1b[5~",
    VK_NEXT: b"\x1b[6~",
}


_FKEY_VT: Dict[int, bytes] = {
    VK_F1: b"\x1bOP",
    VK_F1 + 1: b"\x1bOQ",
    VK_F1 + 2: b"\x1bOR",
    VK_F1 + 3: b"\x1bOS",
    VK_F1 + 4: b"\x1b[15~",
    VK_F1 + 5: b"\x1b[17~",
    VK_F1 + 6: b"\x1b[18~",
    VK_F1 + 7: b"\x1b[19~",
    VK_F1 + 8: b"\x1b[20~",
    VK_F1 + 9: b"\x1b[21~",
    VK_F1 + 10: b"\x1b[23~",
    VK_F1 + 11: b"\x1b[24~",
}


def _winerr(msg: str) -> RuntimeError:
    err = ctypes.get_last_error()
    return RuntimeError(f"{msg} (WinError={err})")


def _modifier_param(control_state: int) -> int:
    """
    xterm CSI modifier parameter:
      2=Shift, 3=Alt, 5=Ctrl, 4=Shift+Alt, 6=Shift+Ctrl, 7=Alt+Ctrl, 8=Shift+Alt+Ctrl.
    """
    shift = bool(control_state & SHIFT_PRESSED)
    alt = bool(control_state & (LEFT_ALT_PRESSED | RIGHT_ALT_PRESSED))
    ctrl = bool(control_state & (LEFT_CTRL_PRESSED | RIGHT_CTRL_PRESSED))
    if not (shift or alt or ctrl):
        return 1
    return 1 + (1 if shift else 0) + (2 if alt else 0) + (4 if ctrl else 0)


def _apply_modifiers_to_csi(seq: bytes, control_state: int) -> bytes:
    mod = _modifier_param(control_state)
    if mod == 1:
        return seq
    # Arrow/home/end sequences are usually ESC [ <code>. Convert to ESC [ 1 ; <mod> <code>.
    if seq.startswith(b"\x1b[") and seq.endswith((b"A", b"B", b"C", b"D", b"H", b"F")) and len(seq) == 3:
        return b"\x1b[1;" + str(mod).encode("ascii") + seq[-1:]
    return seq


def _key_event_to_bytes(ev: KEY_EVENT_RECORD) -> Optional[bytes]:
    if not ev.bKeyDown:
        return None

    vk = int(ev.wVirtualKeyCode)
    ch = ev.uChar
    control = int(ev.dwControlKeyState)
    alt = bool(control & (LEFT_ALT_PRESSED | RIGHT_ALT_PRESSED))
    ctrl = bool(control & (LEFT_CTRL_PRESSED | RIGHT_CTRL_PRESSED))

    # Printable Unicode char path.
    if ch and ch != "\x00":
        data = ch.encode("utf-8", errors="replace")
        if alt:
            data = b"\x1b" + data
        return data

    # Control combinations for letters without UnicodeChar.
    if ctrl and VK_A <= vk <= VK_Z:
        code = (vk - VK_A) + 1
        data = bytes([code])
        if alt:
            data = b"\x1b" + data
        return data

    if vk == VK_RETURN:
        return b"\r"
    if vk == VK_TAB:
        return b"\t"
    if vk == VK_ESCAPE:
        return b"\x1b"
    if vk == VK_BACK:
        # Use DEL for terminal backspace in most VT contexts.
        return b"\x7f"
    if vk == VK_SPACE:
        return b" "

    if vk in _SPECIAL_KEY_CSI:
        seq = _SPECIAL_KEY_CSI[vk]
        seq = _apply_modifiers_to_csi(seq, control)
        if alt:
            # xterm often uses ESC prefix for Alt+<key> when not using modifier params.
            # For CSI-modified arrows we already encoded Alt into the modifier param,
            # but ESC prefix is still widely accepted; avoid double-encoding.
            if b";" not in seq:
                seq = b"\x1b" + seq
        return seq

    if VK_F1 <= vk <= VK_F12:
        seq = _FKEY_VT.get(vk)
        if seq is None:
            return None
        if alt:
            seq = b"\x1b" + seq
        return seq

    return None


def iter_console_input_bytes(
    *,
    poll_interval_s: float = 0.02,
    should_stop: Optional[Callable[[], bool]] = None,
) -> Iterator[bytes]:
    """
    Yield VT-oriented bytes produced from Windows KEY_EVENT input records.

    This is intended for ConPTY stdin.
    """
    h_in = int(GetStdHandle(STD_INPUT_HANDLE))
    require(h_in not in (0, int(INVALID_HANDLE_VALUE)), "stdin is not a valid Windows console handle")

    mode = wintypes.DWORD(0)
    ok = GetConsoleMode(wintypes.HANDLE(h_in), ctypes.byref(mode))
    require(bool(ok), "stdin is not a console handle (no console mode)")

    n_events = wintypes.DWORD(0)
    rec = INPUT_RECORD()
    read_n = wintypes.DWORD(0)

    while True:
        if should_stop is not None and should_stop():
            return
        ok = GetNumberOfConsoleInputEvents(wintypes.HANDLE(h_in), ctypes.byref(n_events))
        if not ok:
            raise _winerr("GetNumberOfConsoleInputEvents failed")

        if int(n_events.value) <= 0:
            time.sleep(poll_interval_s)
            continue

        ok = ReadConsoleInputW(wintypes.HANDLE(h_in), ctypes.byref(rec), 1, ctypes.byref(read_n))
        if not ok:
            raise _winerr("ReadConsoleInputW failed")
        if int(read_n.value) != 1:
            continue

        if int(rec.EventType) != KEY_EVENT:
            continue

        out = _key_event_to_bytes(rec.KeyEvent)
        if out is not None and out != b"":
            yield out
