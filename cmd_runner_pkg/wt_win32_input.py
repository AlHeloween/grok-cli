from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple


ESC = 0x1B
CSI_8BIT = 0x9B

# Windows CONTROL_KEY_STATE bits (subset)
RIGHT_ALT_PRESSED = 0x0001
LEFT_ALT_PRESSED = 0x0002
RIGHT_CTRL_PRESSED = 0x0004
LEFT_CTRL_PRESSED = 0x0008


_VK_TO_VT: Dict[int, bytes] = {
    0x08: b"\x7f",      # VK_BACK (DEL is typical for terminals)
    0x09: b"\t",        # VK_TAB
    0x0D: b"\r",        # VK_RETURN
    0x1B: b"\x1b",      # VK_ESCAPE
    0x21: b"\x1b[5~",   # VK_PRIOR (PageUp)
    0x22: b"\x1b[6~",   # VK_NEXT (PageDown)
    0x23: b"\x1b[F",    # VK_END
    0x24: b"\x1b[H",    # VK_HOME
    0x25: b"\x1b[D",    # VK_LEFT
    0x26: b"\x1b[A",    # VK_UP
    0x27: b"\x1b[C",    # VK_RIGHT
    0x28: b"\x1b[B",    # VK_DOWN
    0x2D: b"\x1b[2~",   # VK_INSERT
    0x2E: b"\x1b[3~",   # VK_DELETE
}


def _ctrl_down(state: int) -> bool:
    return (state & (RIGHT_CTRL_PRESSED | LEFT_CTRL_PRESSED)) != 0


def _alt_down(state: int) -> bool:
    return (state & (RIGHT_ALT_PRESSED | LEFT_ALT_PRESSED)) != 0


def _vk_letter_to_control(vk: int) -> Optional[int]:
    if 0x41 <= vk <= 0x5A:  # A-Z
        return vk - 0x40  # A->1 ... Z->26
    return None


def _decode_key_event(
    vk: int,
    unicode_char: int,
    key_down: int,
    control_key_state: int,
    repeat: int,
) -> bytes:
    if int(key_down) == 0:
        return b""

    rep = 1 if repeat <= 0 else int(repeat)

    if unicode_char:
        ch = chr(int(unicode_char))
        # Normalize Windows Terminal's CR/LF variants to CR for TTY-style input.
        if ch == "\n":
            out = b"\r"
        else:
            out = ch.encode("utf-8", errors="replace")
        return out * rep

    if _ctrl_down(int(control_key_state)):
        ctrl = _vk_letter_to_control(int(vk))
        if ctrl is not None:
            return bytes([ctrl]) * rep

    vt = _VK_TO_VT.get(int(vk))
    if vt is not None:
        return vt * rep

    if _alt_down(int(control_key_state)):
        # Best-effort Alt+<letter> support if WT did not provide unicode_char.
        if 0x41 <= vk <= 0x5A:
            return (b"\x1b" + bytes([vk + 0x20])) * rep  # ESC + lowercase letter

    return b""


@dataclass
class Win32InputDecodeStats:
    packets_seen: int = 0
    packets_decoded: int = 0
    bytes_out: int = 0
    focus_events_dropped: int = 0


class Win32InputStreamDecoder:
    """
    Decode Windows Terminal "win32-input-mode" key packets into VT-ish bytes.

    WT may emit sequences like:
      ESC [ Vk ; Scan ; UnicodeChar ; KeyDown ; ControlKeyState ; RepeatCount _
    We translate KeyDown packets into bytes and drop KeyUp packets.

    This is a best-effort decoder intended to make interactive input usable
    when cmd_runner stdin is a pipe (common under Windows Terminal).
    """

    def __init__(self) -> None:
        self._buf = bytearray()
        self.stats = Win32InputDecodeStats()

    def feed(self, chunk: bytes) -> bytes:
        if not chunk:
            return b""
        self._buf += chunk
        out = bytearray()

        while self._buf:
            b0 = self._buf[0]
            if b0 not in (ESC, CSI_8BIT):
                out.append(b0)
                del self._buf[0:1]
                continue

            # Parse CSI sequences:
            # - 7-bit form: ESC [
            # - 8-bit form: single byte CSI (0x9B)
            if b0 == ESC:
                # Need at least ESC + one more byte.
                if len(self._buf) < 2:
                    break
                if self._buf[1] != ord("["):
                    # Unknown ESC sequence: pass through one byte to avoid deadlock.
                    out.append(b0)
                    del self._buf[0:1]
                    continue
                csi_start = 2
                passthrough_prefix = b"\x1b["
            else:
                # 8-bit CSI
                csi_start = 1
                # Normalize to 7-bit CSI for child compatibility.
                passthrough_prefix = b"\x1b["

            # Parse CSI: (CSI) <params/intermediates> <final>
            j = csi_start
            while True:
                if j >= len(self._buf):
                    return bytes(out)  # incomplete CSI
                bj = self._buf[j]
                if 0x30 <= bj <= 0x3F:  # params
                    j += 1
                    continue
                if 0x20 <= bj <= 0x2F:  # intermediates
                    j += 1
                    continue
                if 0x40 <= bj <= 0x7E:  # final byte
                    final = bj
                    body = bytes(self._buf[csi_start:j])
                    raw_seq = bytes(self._buf[0 : j + 1])
                    del self._buf[0 : j + 1]

                    # Drop focus in/out events: CSI I / CSI O (no params)
                    if not body and final in (ord("I"), ord("O")):
                        self.stats.focus_events_dropped += 1
                        break

                    # Win32-input-mode uses CSI ... _ with 6 numeric params.
                    if final == ord("_"):
                        self.stats.packets_seen += 1
                        try:
                            s = body.decode("ascii", errors="strict")
                            parts = s.split(";")
                            if len(parts) != 6:
                                break
                            vk, scan, uc, down, state, rep = (int(p or "0") for p in parts)
                        except Exception:
                            break

                        decoded = _decode_key_event(vk, uc, down, state, rep)
                        if decoded:
                            out += decoded
                            self.stats.packets_decoded += 1
                            self.stats.bytes_out += len(decoded)
                        break

                    # Standard CSI: pass through unchanged (normalize 8-bit CSI to ESC[).
                    if raw_seq and raw_seq[0] == CSI_8BIT:
                        out += passthrough_prefix + body + bytes([final])
                    else:
                        out += raw_seq
                    break

                # Invalid byte inside CSI: pass through ESC and resync.
                out.append(ESC)
                del self._buf[0:1]
                break

                continue

        return bytes(out)
