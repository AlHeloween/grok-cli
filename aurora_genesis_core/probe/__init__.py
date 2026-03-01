"""
Probe module: Dual-quaternion encoder and attention for Aurora Genesis.

This module implements the "Probe" encoder (Phase 5.6) as specified in Aurora-Genesis.pdf,
including DQLinear (Hamilton product-based linear layer) and dual-quaternion attention.
"""

from __future__ import annotations

from aurora_genesis_core.probe.dual_quaternion import (
    DualQuaternionTensor,
    hamilton_product,
    dual_quat_conjugate,
    dual_quat_normalize,
    dual_quat_inverse,
    # Batched operations for vectorized computation
    batched_quat_multiply,
    batched_quat_conjugate,
    batched_hamilton_product,
    batched_dual_quat_conjugate,
    batched_dual_quat_similarity,
    pairwise_dual_quat_similarity,
)

__all__ = [
    "DualQuaternionTensor",
    "hamilton_product",
    "dual_quat_conjugate",
    "dual_quat_normalize",
    "dual_quat_inverse",
    # Batched operations
    "batched_quat_multiply",
    "batched_quat_conjugate",
    "batched_hamilton_product",
    "batched_dual_quat_conjugate",
    "batched_dual_quat_similarity",
    "pairwise_dual_quat_similarity",
]
