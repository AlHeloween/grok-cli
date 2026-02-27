from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from .util import require, utc_now_iso


@dataclass(frozen=True)
class InboxMessage:
    text: Optional[str]
    data: Optional[bytes]
    keys: Optional[list[str]]
    add_crlf: bool


def _parse_inbox_line(line: str) -> InboxMessage:
    """
    Inbox format: JSONL, one object per line.

    Supported shapes:
      - {"text": "...", "add_crlf": true|false}
      - {"data_b64": "...", "add_crlf": true|false}
      - {"keys": ["LEFT","TEXT:hi","ENTER"], "add_crlf": true|false}
    """
    obj = json.loads(line)
    require(isinstance(obj, dict), "inbox line must be a JSON object")

    # Policy: do not inject Enter implicitly; callers must opt-in.
    add_crlf = bool(obj.get("add_crlf", False))

    if "text" in obj:
        text = obj["text"]
        require(isinstance(text, str), "text must be a string")
        return InboxMessage(text=text, data=None, keys=None, add_crlf=add_crlf)

    if "data_b64" in obj:
        b64 = obj["data_b64"]
        require(isinstance(b64, str), "data_b64 must be a string")
        data = base64.b64decode(b64.encode("ascii"), validate=True)
        return InboxMessage(text=None, data=data, keys=None, add_crlf=add_crlf)

    if "keys" in obj:
        keys = obj["keys"]
        require(isinstance(keys, list), "keys must be a list")
        for k in keys:
            require(isinstance(k, str), "keys entries must be strings")
        return InboxMessage(text=None, data=None, keys=list(keys), add_crlf=add_crlf)

    raise RuntimeError("inbox line must contain 'text' or 'data_b64' or 'keys'")


def pump_inbox_jsonl(
    inbox_path: Path,
    *,
    send_message,
    should_stop,
    on_error=None,
    poll_interval_s: float = 0.05,
) -> None:
    """
    Tail `inbox.jsonl` and forward commands into the running session.

    - `send_message(InboxMessage, meta: Dict[str, Any])` is called per parsed message.
    - `should_stop()` stops the loop when True.
    """
    require(inbox_path.is_file(), "inbox.jsonl missing")

    # Always open in binary; handle UTF-8 decode per line.
    pos = 0
    buf = b""
    while not should_stop():
        try:
            with inbox_path.open("rb") as f:
                f.seek(pos, os.SEEK_SET)
                chunk = f.read(65536)
                if not chunk:
                    time.sleep(poll_interval_s)
                    continue
                pos = f.tell()
        except OSError:
            time.sleep(poll_interval_s)
            continue

        buf += chunk
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                msg = _parse_inbox_line(line)
                meta: Dict[str, Any] = {"source": "inbox", "ts_utc": utc_now_iso()}
                send_message(msg, meta)
            except Exception as e:
                if on_error is not None:
                    try:
                        on_error(f"inbox parse/send error: {e} line={line!r}")
                    except Exception:
                        pass
                # Skip invalid lines to keep the session stable.
                continue
