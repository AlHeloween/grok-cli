"""
Dual complex (Dual Phasor) API.

This module keeps the repo importable without PyTorch. When PyTorch is available,
it re-exports the Torch backend implementation from `torch_backend.py`.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from typing import Any


_TORCH_AVAILABLE = importlib.util.find_spec("torch") is not None

if _TORCH_AVAILABLE:
    from .torch_backend import (  # noqa: F401
        DualComplexLinear,
        DualComplexTensor,
        dual_sigmoid,
        dual_silu,
        dual_tanh,
    )
else:

    def _torch_required(name: str) -> None:
        raise ImportError(
            f"`{name}` requires PyTorch. Install project dependencies so `torch` is available (see docs/handover.md)."
        )

    @dataclass(frozen=True)
    class DualComplexTensor:
        data: Any  # expected: tensor-like with last dim=2 (primal, dual)

        @property
        def primal(self) -> Any:
            return self.data[..., 0]

        @property
        def dual(self) -> Any:
            return self.data[..., 1]

    class DualComplexLinear:  # type: ignore[override]
        def __init__(self, *_: Any, **__: Any) -> None:
            _torch_required("DualComplexLinear")

    def dual_tanh(_: Any) -> Any:
        _torch_required("dual_tanh")

    def dual_sigmoid(_: Any) -> Any:
        _torch_required("dual_sigmoid")

    def dual_silu(_: Any) -> Any:
        _torch_required("dual_silu")
