from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from .util import require


def resolve_tool_executable(tool_name: str) -> str:
    # Rule: ./tools/ first, then PATH. No other legacy fallbacks.
    tools_dir = Path.cwd() / "tools"
    if tools_dir.is_dir():
        candidates = []
        if os.name == "nt":
            # Windows: look for .exe/.cmd/.bat and bare
            exts = [".exe", ".cmd", ".bat", ""]
        else:
            exts = ["", ".sh"]  # keep minimal; primarily Linux/WSL
        for ext in exts:
            p = tools_dir / (tool_name + ext)
            candidates.append(p)
            if p.is_file():
                return str(p)

    # PATH resolution
    from shutil import which
    p = which(tool_name)
    require(p is not None, f"Tool not found in ./tools/ or PATH: {tool_name}")
    return p
