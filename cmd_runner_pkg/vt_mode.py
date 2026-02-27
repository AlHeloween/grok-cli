from __future__ import annotations

import threading
from dataclasses import dataclass


@dataclass
class VtModeSnapshot:
    application_cursor: bool
    application_keypad: bool


class VtModeTracker:
    """
    Track a minimal subset of VT modes that affect input encoding.

    We only implement the pieces we need for reliable key injection:
      - DECCKM (application cursor keys): CSI ? 1 h / CSI ? 1 l
      - DECKPAM/DECKPNM (application keypad): ESC = / ESC >

    This tracker is fed the child's *output* stream. Real terminals use these
    sequences to decide how to encode subsequent keypresses. When we inject
    keys programmatically (bypassing the user's terminal), we must replicate
    that behavior to keep interactive apps working.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._application_cursor = False
        self._application_keypad = False
        self._carry = b""

    def snapshot(self) -> VtModeSnapshot:
        with self._lock:
            return VtModeSnapshot(
                application_cursor=bool(self._application_cursor),
                application_keypad=bool(self._application_keypad),
            )

    def feed(self, chunk: bytes) -> None:
        if not chunk:
            return
        data = self._carry + bytes(chunk)

        # DECCKM: application cursor keys on/off
        on = data.rfind(b"\x1b[?1h")
        off = data.rfind(b"\x1b[?1l")

        # DECKPAM/DECKPNM: application keypad on/off
        kp_on = data.rfind(b"\x1b=")
        kp_off = data.rfind(b"\x1b>")

        with self._lock:
            if on >= 0 or off >= 0:
                self._application_cursor = bool(on > off)
            if kp_on >= 0 or kp_off >= 0:
                self._application_keypad = bool(kp_on > kp_off)

        # Keep a small tail for boundary-spanning sequences.
        self._carry = data[-16:]

