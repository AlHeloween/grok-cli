#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path
from typing import Optional


def extract_with_sqlite_rag(p: Path, max_bytes: Optional[int]) -> str:
    from sqlite_rag.reader import FileReader

    return FileReader.parse_file(p, max_document_size_bytes=max_bytes)


def extract_with_markitdown(p: Path, max_bytes: Optional[int]) -> str:
    from markitdown import MarkItDown, StreamInfo

    converter = MarkItDown()
    text = converter.convert(p, stream_info=StreamInfo(charset="utf8")).text_content

    b = text.encode("utf-8", errors="ignore")
    if max_bytes:
        b = b[:max_bytes]

    return b.decode("utf-8", errors="ignore")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", required=True)
    ap.add_argument("--max-bytes", type=int, default=0)
    args = ap.parse_args()

    p = Path(args.path)
    if not p.exists():
        print(f"File not found: {p}", file=sys.stderr)
        return 2

    max_bytes: Optional[int] = args.max_bytes if args.max_bytes and args.max_bytes > 0 else None

    try:
        try:
            text = extract_with_sqlite_rag(p, max_bytes)
        except Exception:
            text = extract_with_markitdown(p, max_bytes)

        sys.stdout.write(text or "")
        return 0

    except ImportError as e:
        print(
            "Missing Python dependency. Install one of: sqlite-rag (recommended), markitdown",
            file=sys.stderr,
        )
        print(str(e), file=sys.stderr)
        return 3
    except Exception as e:
        print(f"Extraction failed: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

# ADID_ROLLBACK (from adm.exe)
# SDID_ROLLBACK {
#   "target_file": "D:\\zPython\\grok-cli\\scripts/sqlite_rag_extract.py"
#   "update_script": "adm.exe"
#   "backup_path": "none"
#   "created_at": "2026-02-16T14:47:57.748544+00:00"
#   "new_hash": "171e8949e81a3f8b48d4b9f4ebcc327f"
#   "goal_id": "scripts_sqlite_rag_extract_create"
#   "semantics": "Add a tiny Python bridge that uses sqlite-rag's FileReader (markitdown) to extract text from non-plain files during indexing."
#   "update_attrs": {"relative_path": "scripts/sqlite_rag_extract.py", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
#   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\scripts/sqlite_rag_extract.py\""
# }
