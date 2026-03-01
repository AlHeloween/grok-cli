'''Stability gates: numerical stability, performance, and correctness checks.'''

from __future__ import annotations

from typing import Optional

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore

if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.pipeline.stability requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )


def clamp_quaternion_dot(dot_product: torch.Tensor, eps: float = 1e-7) -> torch.Tensor:
    """
    Clamp quaternion inner product to [-1, 1] for numerical stability in arccos.

    Args:
        dot_product: Quaternion inner product tensor (any shape).
        eps: Epsilon for numerical stability.

    Returns:
        Clamped dot product tensor.
    """
    return torch.clamp(dot_product, -1.0 + eps, 1.0 - eps)


def normalize_dual_quaternion(dq: torch.Tensor, eps: float = 1e-8) -> torch.Tensor:
    """
    Enforce unit dual-quaternion normalization (real part has unit norm).

    Args:
        dq: Dual quaternion tensor (..., 8) with components [wr, xr, yr, zr, wd, xd, yd, zd].
        eps: Epsilon for numerical stability.

    Returns:
        Normalized dual quaternion tensor (same shape).
    """
    if dq.shape[-1] != 8:
        raise ValueError(f"Expected dual quaternion with last dim=8, got {dq.shape[-1]}")

    # Normalize real part (first 4 components)
    real = dq[..., :4]  # (..., 4)
    real_norm = torch.norm(real, dim=-1, keepdim=True)  # (..., 1)
    real_normalized = real / (real_norm + eps)

    # Scale dual part by same factor
    dual = dq[..., 4:]  # (..., 4)
    dual_normalized = dual / (real_norm + eps)

    # Concatenate
    dq_normalized = torch.cat([real_normalized, dual_normalized], dim=-1)  # (..., 8)
    return dq_normalized


def check_finite_tensor(tensor: torch.Tensor, name: str = "tensor") -> bool:
    """
    Check if tensor contains only finite values (no NaN or Inf).

    Args:
        tensor: Tensor to check.
        name: Name for error messages.

    Returns:
        True if tensor is finite, False otherwise.

    Raises:
        ValueError: If tensor contains NaN or Inf (with descriptive message).
    """
    if not torch.isfinite(tensor).all():
        n_nan = torch.isnan(tensor).sum().item()
        n_inf = torch.isinf(tensor).sum().item()
        raise ValueError(
            f"{name} contains non-finite values: {n_nan} NaN, {n_inf} Inf"
        )
    return True


def check_valid_dual_quaternion(dq: torch.Tensor, name: str = "dual_quaternion") -> bool:
    """
    Check if dual quaternion is valid (normalized real part, finite values).

    Args:
        dq: Dual quaternion tensor (..., 8).
        name: Name for error messages.

    Returns:
        True if dual quaternion is valid.

    Raises:
        ValueError: If dual quaternion is invalid.
    """
    # Check shape
    if dq.shape[-1] != 8:
        raise ValueError(f"{name} must have last dim=8, got {dq.shape[-1]}")

    # Check finite
    check_finite_tensor(dq, name)

    # Check real part is normalized (approximately)
    real = dq[..., :4]
    real_norm = torch.norm(real, dim=-1)
    if not torch.allclose(real_norm, torch.ones_like(real_norm), atol=1e-3):
        raise ValueError(
            f"{name} real part is not normalized. Norm range: [{real_norm.min().item():.6f}, {real_norm.max().item():.6f}]"
        )

    return True


def check_valid_medoids(medoids: torch.Tensor, name: str = "medoids") -> bool:
    """
    Check if medoids are valid (not NaN, not all zeros, normalized).

    Args:
        medoids: Medoids tensor (k, 8).
        name: Name for error messages.

    Returns:
        True if medoids are valid.

    Raises:
        ValueError: If medoids are invalid.
    """
    # Check shape
    if medoids.shape[-1] != 8:
        raise ValueError(f"{name} must have last dim=8, got {medoids.shape[-1]}")

    # Check not all zeros
    if torch.allclose(medoids, torch.zeros_like(medoids)):
        raise ValueError(f"{name} are all zeros")

    # Check valid dual quaternions
    for i in range(medoids.shape[0]):
        check_valid_dual_quaternion(medoids[i], f"{name}[{i}]")

    return True
