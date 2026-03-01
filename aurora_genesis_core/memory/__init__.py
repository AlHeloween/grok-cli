'''Genesis memory module: Sierpinski initialization + SE(3) clustering integration.'''

from __future__ import annotations

import importlib.util

if importlib.util.find_spec("torch") is None:
    __all__ = []
else:
    from aurora_genesis_core.memory.genesis import GenesisMemory
    from aurora_genesis_core.memory.text_fractal_memory import (
        TextFractalMemoryBank,
        TextFractalMemoryBanks,
        TextMemoryEntry,
        build_text_memory_banks,
        format_memory_injection,
        format_memory_injection_lines,
    )

    __all__ = [
        "GenesisMemory",
        "TextFractalMemoryBank",
        "TextFractalMemoryBanks",
        "TextMemoryEntry",
        "build_text_memory_banks",
        "format_memory_injection",
        "format_memory_injection_lines",
    ]
