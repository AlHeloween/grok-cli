"""Clustering primitives (torch required)."""

from __future__ import annotations

import importlib.util

if importlib.util.find_spec("torch") is None:
    raise ImportError(
        "aurora_genesis_core.clustering requires torch. Install project dependencies so `torch` is available (see docs/handover.md)."
    )

from .kmedoids_l2 import kmedoids_pam_l2

__all__ = ["kmedoids_pam_l2"]
