from __future__ import annotations

from dataclasses import dataclass


@dataclass
class _State:
    mode: str = "text"  # text|esc|csi|osc|dcs
    osc_terminated_by_esc: bool = False


class AnsiStripper:
    """
    Streaming ANSI/VT escape stripper for log readability.

    Removes CSI/OSC/DCS escape sequences and most control bytes, preserving:
      - LF (\\n), CR (\\r), TAB (\\t)
      - printable UTF-8 text (decoded with replacement for invalid sequences)

    This is intentionally minimal and best-effort; it's for *logs*, not terminal emulation.
    """

    def __init__(self) -> None:
        self._state = _State()
        self._utf8_buf = bytearray()

    def feed(self, data: bytes) -> str:
        out_chars: list[str] = []

        def _flush_utf8() -> None:
            if not self._utf8_buf:
                return
            out_chars.append(self._utf8_buf.decode("utf-8", errors="replace"))
            self._utf8_buf.clear()

        for b in data:
            if self._state.mode == "text":
                if b == 0x1B:  # ESC
                    _flush_utf8()
                    self._state.mode = "esc"
                    self._state.osc_terminated_by_esc = False
                    continue
                if b in (0x0A, 0x0D, 0x09):  # \n \r \t
                    _flush_utf8()
                    out_chars.append(chr(b))
                    continue
                if b < 0x20 or b == 0x7F:
                    # Drop other control bytes.
                    continue
                self._utf8_buf.append(b)
                continue

            if self._state.mode == "esc":
                # ESC dispatch: CSI, OSC, DCS, or single-char escapes.
                if b == ord("["):
                    self._state.mode = "csi"
                    continue
                if b == ord("]"):
                    self._state.mode = "osc"
                    continue
                if b == ord("P"):
                    self._state.mode = "dcs"
                    continue
                # Any other ESC sequence: consume this byte and return to text.
                self._state.mode = "text"
                continue

            if self._state.mode == "csi":
                # CSI ends with a byte in 0x40..0x7E.
                if 0x40 <= b <= 0x7E:
                    self._state.mode = "text"
                continue

            if self._state.mode == "osc":
                # OSC ends with BEL (0x07) or ST (ESC \).
                if self._state.osc_terminated_by_esc:
                    if b == ord("\\"):
                        self._state.mode = "text"
                    else:
                        self._state.osc_terminated_by_esc = False
                    continue
                if b == 0x07:
                    self._state.mode = "text"
                    continue
                if b == 0x1B:
                    self._state.osc_terminated_by_esc = True
                    continue
                continue

            if self._state.mode == "dcs":
                # DCS ends with ST (ESC \). Treat similarly to OSC termination.
                if self._state.osc_terminated_by_esc:
                    if b == ord("\\"):
                        self._state.mode = "text"
                    else:
                        self._state.osc_terminated_by_esc = False
                    continue
                if b == 0x1B:
                    self._state.osc_terminated_by_esc = True
                continue

        _flush_utf8()
        return "".join(out_chars)

