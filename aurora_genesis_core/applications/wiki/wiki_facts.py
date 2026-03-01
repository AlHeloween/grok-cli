from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional


@dataclass(frozen=True)
class WikiFact:
    key: str
    value: str
    title: Optional[str]


def _md5_hex(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _sanitize_key(s: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9_]+", "_", str(s)).strip("_")
    return clean or "K000000"


def wiki_row_to_fact(row: dict[str, Any], *, idx: int) -> WikiFact:
    """
    Convert a WikiSets row into a KEY/VALUE "fact" compatible with long_context_bench.

    VALUE is a deterministic hex token: V_<md5(title)>.
    """

    if not isinstance(row, dict):
        raise TypeError("row must be a dict")

    # Try a few common column names; fall back to stringified row.
    title = None
    for k in ("title", "page_title", "article_title", "name"):
        v = row.get(k)
        if isinstance(v, str) and v.strip():
            title = v.strip()
            break

    if title is None:
        title = str(row.get("id") or row.get("page_id") or row.get("url") or f"row_{idx}").strip()
    if not title:
        title = f"row_{idx}"

    key = f"K{int(idx):06d}"
    value = f"V_{_md5_hex(title)}"
    return WikiFact(key=key, value=value, title=title)


def facts_from_dataset_rows(rows: Iterable[dict[str, Any]], *, start_index: int = 0) -> list[WikiFact]:
    out: list[WikiFact] = []
    for i, row in enumerate(rows):
        out.append(wiki_row_to_fact(row, idx=int(start_index) + i))
    return out


def write_facts_tsv(path: str, facts: list[WikiFact]) -> str:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    lines.append("key\tvalue\ttitle")
    for f in facts:
        title = (f.title or "").replace("\t", " ").replace("\n", " ").strip()
        lines.append(f"{f.key}\t{f.value}\t{title}")
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p.as_posix()


def load_facts_tsv(path: str) -> list[WikiFact]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Facts TSV not found: {p.as_posix()}")
    lines = p.read_text(encoding="utf-8").splitlines()
    out: list[WikiFact] = []
    for line_no, raw in enumerate(lines, start=1):
        if not raw.strip():
            continue
        if line_no == 1 and raw.lower().startswith("key"):
            continue
        parts = raw.split("\t")
        if len(parts) < 2:
            raise ValueError(f"{p.as_posix()}:{line_no}: expected at least 2 columns: key, value")
        key = _sanitize_key(parts[0])
        value = str(parts[1]).strip()
        if not value.startswith("V_"):
            raise ValueError(f"{p.as_posix()}:{line_no}: value must start with 'V_': {value!r}")
        title = parts[2].strip() if len(parts) >= 3 else None
        out.append(WikiFact(key=key, value=value, title=title))
    if not out:
        raise ValueError(f"{p.as_posix()}: no facts")
    return out

