from __future__ import annotations

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=False)


def write_json_atomic(path: Path, obj: Any) -> None:
    # Atomic-ish on Windows: write temp then replace
    tmp = path.with_suffix(path.suffix + ".tmp")
    data = json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True)
    tmp.write_text(data, encoding="utf-8", newline="\n")
    os.replace(str(tmp), str(path))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def new_run_id() -> str:
    # Stable, filesystem-safe, sortable-ish: 20260224T081530Z_5f2c9a6b
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    rand = uuid.uuid4().hex[:8]
    return f"{ts}_{rand}"


def parse_key_value(s: str) -> Tuple[str, str]:
    if "=" not in s:
        raise ValueError("Expected KEY=VALUE")
    k, v = s.split("=", 1)
    if not k:
        raise ValueError("KEY must be non-empty")
    return k, v


def human_bytes(n: int) -> str:
    # For UX only; not used as a compatibility path
    units = ["B", "KiB", "MiB", "GiB"]
    f = float(n)
    for u in units:
        if f < 1024.0 or u == units[-1]:
            return f"{f:.1f}{u}" if u != "B" else f"{int(f)}B"
        f /= 1024.0
    return f"{int(n)}B"


def is_windows() -> bool:
    return os.name == "nt"


def require(condition: bool, msg: str) -> None:
    if not condition:
        raise RuntimeError(msg)


def die(msg: str, code: int = 2) -> int:
    sys.stderr.write(msg.rstrip() + "\n")
    sys.stderr.flush()
    return code
