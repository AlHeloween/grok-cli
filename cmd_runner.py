from __future__ import annotations

"""cmd_runner wrapper (entrypoint).

This file exists as a stable repo-root entrypoint so:
- `python cmd_runner.py ...` works after unzip/cd into a folder (recommended)
- `adm` can find `cmd_runner.py` in the repo root (installer workflow)

Implementation lives in `cmd_runner_pkg/`.
"""

import sys
from pathlib import Path

# Policy: do not allow `python -m cmd_runner` because it is ambiguous (PYTHONPATH collisions).
# Enforce the deterministic entrypoint: `python cmd_runner.py ...` (repo root) or `cmd_runner.exe ...` (release).
if __spec__ is not None:
    sys.stderr.write(
        "Do not use `python -m cmd_runner`.\n"
        "Use `uv run cmd_runner.py ...` from the repo root, or `cmd_runner.exe ...` from the release bundle root.\n"
    )
    raise SystemExit(2)

# Allow direct execution after copying `cmd_runner.py` + `cmd_runner_pkg/` into any folder.
# (Do not require package installation / console script entrypoints.)
sys.path.insert(0, str(Path(__file__).resolve().parent))

from cmd_runner_pkg.cli import main as _main  # noqa: E402


def main() -> int:
    return int(_main())


if __name__ == "__main__":
    raise SystemExit(main())
