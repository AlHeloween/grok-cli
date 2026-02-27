from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

from .vt_mode import VtModeSnapshot


@dataclass(frozen=True)
class EncodedKeys:
    data: bytes
    keys: List[str]


def encode_keys(keys: Iterable[str], *, vt: VtModeSnapshot) -> EncodedKeys:
    """
    Encode high-level keys into bytes, respecting VT modes.

    Supported items:
      - LEFT/RIGHT/UP/DOWN/HOME/END
      - BACKSPACE/DELETE/INSERT/TAB/ESC/ENTER
      - TEXT:<utf8>  (verbatim text)
      - CHAR:<c>     (single unicode char)
      - HEX:<hex>    (raw bytes, hex string)
    """
    out = bytearray()
    normalized: List[str] = []

    def _arrow(name: str) -> None:
        if vt.application_cursor:
            seqs = {"UP": b"\x1bOA", "DOWN": b"\x1bOB", "RIGHT": b"\x1bOC", "LEFT": b"\x1bOD"}
        else:
            seqs = {"UP": b"\x1b[A", "DOWN": b"\x1b[B", "RIGHT": b"\x1b[C", "LEFT": b"\x1b[D"}
        out.extend(seqs[name])

    def _home_end(name: str) -> None:
        if vt.application_cursor:
            seqs = {"HOME": b"\x1bOH", "END": b"\x1bOF"}
        else:
            seqs = {"HOME": b"\x1b[H", "END": b"\x1b[F"}
        out.extend(seqs[name])

    for raw in keys:
        item = str(raw)
        normalized.append(item)
        up = item.upper()

        if up in ("LEFT", "RIGHT", "UP", "DOWN"):
            _arrow(up)
            continue
        if up in ("HOME", "END"):
            _home_end(up)
            continue
        if up == "BACKSPACE":
            out.extend(b"\x7f")
            continue
        if up == "TAB":
            out.extend(b"\t")
            continue
        if up == "ESC":
            out.extend(b"\x1b")
            continue
        if up == "ENTER":
            out.extend(b"\r")
            continue
        if up == "DELETE":
            out.extend(b"\x1b[3~")
            continue
        if up == "INSERT":
            out.extend(b"\x1b[2~")
            continue

        if item.startswith("TEXT:"):
            out.extend(item[len("TEXT:") :].encode("utf-8", errors="replace"))
            continue
        if item.startswith("CHAR:"):
            ch = item[len("CHAR:") :]
            if len(ch) != 1:
                raise ValueError("CHAR: expects exactly one character")
            out.extend(ch.encode("utf-8", errors="replace"))
            continue
        if item.startswith("HEX:"):
            hx = item[len("HEX:") :]
            cleaned = "".join(c for c in hx if c.strip()).replace("_", "").replace(",", "").replace(" ", "")
            if len(cleaned) % 2 != 0:
                raise ValueError("HEX: expects an even number of hex digits")
            out.extend(bytes.fromhex(cleaned))
            continue

        raise ValueError(f"Unsupported key token: {item!r}")

    return EncodedKeys(data=bytes(out), keys=normalized)

