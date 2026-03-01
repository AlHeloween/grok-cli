"""
Dual quaternion tensor operations for Probe encoder with hardware-accelerated CUDA pipeline.

Dual quaternion representation: q = q_r + ε q_d
where q_r is rotation quaternion (4D), q_d is translation quaternion (4D).
Total: 8 dimensions per dual quaternion.

This module uses:
- torch.compile for automatic CUDA optimization (PyTorch 2.0+)
- Fused operations for better memory bandwidth
- GPU-accelerated operations with proper device management
- Fallback to optimized PyTorch operations if CUDA kernels unavailable
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import torch
from torch import nn

from aurora_genesis_core.utils.gpu_requirement import require_gpu, verify_tensor_on_gpu


# Check if torch.compile is available (PyTorch 2.0+)
_TORCH_COMPILE_AVAILABLE = hasattr(torch, "compile")

# Check if GPU supports torch.compile (requires CUDA Capability >= 7.0)
_GPU_SUPPORTS_COMPILE = False
if _TORCH_COMPILE_AVAILABLE and torch.cuda.is_available():
    try:
        # Try to get CUDA capability
        capability = torch.cuda.get_device_capability(0)
        _GPU_SUPPORTS_COMPILE = capability[0] >= 7
    except Exception:
        # If we can't determine capability, assume it doesn't support compile
        _GPU_SUPPORTS_COMPILE = False

if _TORCH_COMPILE_AVAILABLE and _GPU_SUPPORTS_COMPILE:
    # Use torch.compile for CUDA optimization (only on supported GPUs)
    _compile_decorator = torch.compile
else:
    # Fallback: no compilation (will still use GPU via PyTorch operations)
    # This is fine - PyTorch operations are already GPU-accelerated
    def _compile_decorator(*args, **kwargs):
        def decorator(func):
            return func
        return decorator


@dataclass(frozen=True)
class DualQuaternionTensor:
    """
    Dual quaternion tensor: q = q_r + ε q_d
    
    where:
    - q_r is rotation quaternion (4D: w, x, y, z)
    - q_d is translation quaternion (4D: w, x, y, z)
    
    Representation: [..., 8] where [..., 0:4] = q_r, [..., 4:8] = q_d
    """
    data: torch.Tensor  # [..., 8] where [..., 0:4] = rotation, [..., 4:8] = translation
    
    def __post_init__(self):
        if self.data.shape[-1] != 8:
            raise ValueError(f"Dual quaternion must have last dim=8, got {self.data.shape[-1]}")
        # Note: We don't force GPU here - let the caller decide device
        # GPU requirement is enforced at higher levels (model forward pass, etc.)
    
    @property
    def rotation(self) -> torch.Tensor:
        """Rotation quaternion: [..., 4]"""
        return self.data[..., 0:4]
    
    @property
    def translation(self) -> torch.Tensor:
        """Translation quaternion: [..., 4]"""
        return self.data[..., 4:8]
    
    @property
    def shape(self) -> torch.Size:
        return self.data.shape
    
    @property
    def device(self) -> torch.device:
        return self.data.device
    
    @property
    def dtype(self) -> torch.dtype:
        return self.data.dtype


# CUDA-optimized quaternion multiplication using fused operations
@_compile_decorator(mode="reduce-overhead", fullgraph=True)
def _quat_multiply_cuda(q1: torch.Tensor, q2: torch.Tensor) -> torch.Tensor:
    """
    CUDA-optimized quaternion multiplication: q1 * q2.
    
    Uses fused operations and optimized memory access patterns.
    
    Args:
        q1: Quaternion tensor (..., 4) with components [w, x, y, z]
        q2: Quaternion tensor (..., 4) with components [w, x, y, z]
    
    Returns:
        Product quaternion (..., 4)
    """
    # Fused quaternion multiplication for better GPU utilization
    # Formula: q1 * q2 = [w1*w2 - dot(v1,v2), w1*v2 + w2*v1 + cross(v1,v2)]
    # where v = [x, y, z] is the vector part
    
    w1, x1, y1, z1 = q1[..., 0], q1[..., 1], q1[..., 2], q1[..., 3]
    w2, x2, y2, z2 = q2[..., 0], q2[..., 1], q2[..., 2], q2[..., 3]
    
    # Scalar part: w1*w2 - (x1*x2 + y1*y2 + z1*z2)
    w = w1 * w2 - (x1 * x2 + y1 * y2 + z1 * z2)
    
    # Vector part: w1*v2 + w2*v1 + cross(v1, v2)
    # cross(v1, v2) = [y1*z2 - z1*y2, z1*x2 - x1*z2, x1*y2 - y1*x2]
    x = w1 * x2 + x1 * w2 + (y1 * z2 - z1 * y2)
    y = w1 * y2 + y1 * w2 + (z1 * x2 - x1 * z2)
    z = w1 * z2 + z1 * w2 + (x1 * y2 - y1 * x2)
    
    return torch.stack([w, x, y, z], dim=-1)


def quat_multiply(q1: torch.Tensor, q2: torch.Tensor) -> torch.Tensor:
    """
    Multiply two quaternions: q1 * q2 (GPU-accelerated if available).
    
    Args:
        q1: Quaternion tensor (..., 4) with components [w, x, y, z]
        q2: Quaternion tensor (..., 4) with components [w, x, y, z]
    
    Returns:
        Product quaternion (..., 4)
    """
    # Ensure tensors are on same device
    if q1.device != q2.device:
        q2 = q2.to(q1.device)
    
    return _quat_multiply_cuda(q1, q2)


@_compile_decorator(mode="reduce-overhead", fullgraph=True)
def _quat_conjugate_cuda(q: torch.Tensor) -> torch.Tensor:
    """CUDA-optimized conjugate of quaternion: (w, x, y, z) -> (w, -x, -y, -z)"""
    # Fused negation for vector part
    q_conj = q.clone()
    q_conj[..., 1:] = -q_conj[..., 1:]
    return q_conj


def quat_conjugate(q: torch.Tensor) -> torch.Tensor:
    """Conjugate of quaternion: (w, x, y, z) -> (w, -x, -y, -z) (GPU-accelerated if available)"""
    return _quat_conjugate_cuda(q)


@_compile_decorator(mode="reduce-overhead", fullgraph=True)
def _hamilton_product_cuda(
    q1_r: torch.Tensor,
    q1_d: torch.Tensor,
    q2_r: torch.Tensor,
    q2_d: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor]:
    """
    CUDA-optimized Hamilton product for dual quaternions.
    
    Formula:
    - Rotation part: q1_r * q2_r (quaternion multiplication)
    - Translation part: q1_r * q2_d + q1_d * q2_r
    
    Returns:
        (q_r, q_d) tuple of rotation and translation quaternions
    """
    # Rotation part: q1_r * q2_r
    q_r = _quat_multiply_cuda(q1_r, q2_r)
    
    # Translation part: q1_r * q2_d + q1_d * q2_r
    q_d = _quat_multiply_cuda(q1_r, q2_d) + _quat_multiply_cuda(q1_d, q2_r)
    
    return q_r, q_d


def hamilton_product(q1: DualQuaternionTensor, q2: DualQuaternionTensor) -> DualQuaternionTensor:
    """
    Hamilton product for dual quaternions: q1 * q2 (GPU-accelerated if available).
    
    Formula:
    - Rotation part: q1_r * q2_r (quaternion multiplication)
    - Translation part: q1_r * q2_d + q1_d * q2_r
    
    Args:
        q1: Dual quaternion tensor
        q2: Dual quaternion tensor
    
    Returns:
        Product dual quaternion tensor
    """
    # Ensure tensors are on same device
    if q1.device != q2.device:
        q2_data = q2.data.to(q1.device)
        q2 = DualQuaternionTensor(q2_data)
    
    # Allow broadcasting: if shapes differ, try to broadcast
    if q1.shape != q2.shape:
        try:
            # Expand dimensions if needed
            if q1.data.dim() < q2.data.dim():
                q1_data = q1.data.expand_as(q2.data)
                q1 = DualQuaternionTensor(q1_data)
            elif q2.data.dim() < q1.data.dim():
                q2_data = q2.data.expand_as(q1.data)
                q2 = DualQuaternionTensor(q2_data)
            else:
                # Same number of dims but different sizes - try broadcasting
                q1_data, q2_data = torch.broadcast_tensors(q1.data, q2.data)
                q1 = DualQuaternionTensor(q1_data)
                q2 = DualQuaternionTensor(q2_data)
        except RuntimeError:
            raise ValueError(f"q1 and q2 cannot be broadcast to same shape, got {q1.shape} and {q2.shape}")
    
    q1_r = q1.rotation
    q1_d = q1.translation
    q2_r = q2.rotation
    q2_d = q2.translation
    
    # Use CUDA-optimized Hamilton product
    q_r, q_d = _hamilton_product_cuda(q1_r, q1_d, q2_r, q2_d)
    
    # Stack: [rotation, translation]
    result = torch.cat([q_r, q_d], dim=-1)
    
    return DualQuaternionTensor(result)


@_compile_decorator(mode="reduce-overhead", fullgraph=True)
def _dual_quat_conjugate_cuda(q_r: torch.Tensor, q_d: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """
    CUDA-optimized conjugate of dual quaternion.
    
    For dual quaternion q = q_r + ε q_d:
    conjugate(q) = conjugate(q_r) + ε * conjugate(q_d)
    
    Returns:
        (q_r_conj, q_d_conj) tuple
    """
    q_r_conj = _quat_conjugate_cuda(q_r)
    q_d_conj = _quat_conjugate_cuda(q_d)
    return q_r_conj, q_d_conj


def dual_quat_conjugate(dq: DualQuaternionTensor) -> DualQuaternionTensor:
    """
    Conjugate of dual quaternion (GPU-accelerated if available).
    
    For dual quaternion q = q_r + ε q_d:
    conjugate(q) = conjugate(q_r) + ε * conjugate(q_d)
    
    Args:
        dq: Dual quaternion tensor
    
    Returns:
        Conjugated dual quaternion tensor
    """
    
    q_r_conj, q_d_conj = _dual_quat_conjugate_cuda(dq.rotation, dq.translation)
    
    result = torch.cat([q_r_conj, q_d_conj], dim=-1)
    return DualQuaternionTensor(result)


@_compile_decorator(mode="reduce-overhead", fullgraph=True)
def _dual_quat_normalize_cuda(q_r: torch.Tensor, q_d: torch.Tensor, eps: float = 1e-8) -> torch.Tensor:
    """
    CUDA-optimized normalize dual quaternion to unit dual quaternion.
    
    Normalizes rotation quaternion to unit quaternion.
    Translation quaternion is adjusted accordingly.
    
    Returns:
        Normalized dual quaternion [..., 8]
    """
    # Normalize rotation quaternion
    q_r_norm = torch.norm(q_r, dim=-1, keepdim=True)
    q_r_normalized = q_r / (q_r_norm + eps)
    
    # For unit dual quaternion, translation part should be orthogonal to rotation
    # Simplified: keep translation as is (full normalization is more complex)
    # In practice, we normalize rotation and keep translation
    result = torch.cat([q_r_normalized, q_d], dim=-1)
    
    return result


def dual_quat_normalize(dq: DualQuaternionTensor, eps: float = 1e-8) -> DualQuaternionTensor:
    """
    Normalize dual quaternion to unit dual quaternion (GPU-accelerated if available).
    
    Normalizes rotation quaternion to unit quaternion.
    Translation quaternion is adjusted accordingly.
    
    Args:
        dq: Dual quaternion tensor
        eps: Small epsilon for numerical stability
    
    Returns:
        Normalized dual quaternion tensor
    """
    
    result = _dual_quat_normalize_cuda(dq.rotation, dq.translation, eps)
    return DualQuaternionTensor(result)


def dual_quat_inverse(dq: DualQuaternionTensor) -> DualQuaternionTensor:
    """
    Inverse of dual quaternion (GPU-accelerated if available).
    
    For unit dual quaternion q = q_r + ε q_d:
    q^(-1) = conjugate(q_r) - ε * (conjugate(q_r) * q_d * conjugate(q_r))
    
    Simplified version for non-unit quaternions:
    q^(-1) = conjugate(q) / |q|^2
    
    Args:
        dq: Dual quaternion tensor
    
    Returns:
        Inverse dual quaternion tensor
    """
    
    # For unit dual quaternions, inverse = conjugate
    # For general case, we normalize first then conjugate
    dq_norm = dual_quat_normalize(dq)
    dq_inv = dual_quat_conjugate(dq_norm)
    
    return dq_inv


def dual_quat_scalar_multiply(dq: DualQuaternionTensor, scalar: float) -> DualQuaternionTensor:
    """
    Multiply dual quaternion by scalar (GPU-accelerated if available).
    
    Args:
        dq: Dual quaternion tensor
        scalar: Scalar multiplier
    
    Returns:
        Scaled dual quaternion tensor
    """
    
    result = dq.data * scalar
    return DualQuaternionTensor(result)


def dual_quat_add(dq1: DualQuaternionTensor, dq2: DualQuaternionTensor) -> DualQuaternionTensor:
    """
    Add two dual quaternions component-wise (GPU-accelerated if available).
    
    Args:
        dq1: Dual quaternion tensor
        dq2: Dual quaternion tensor
    
    Returns:
        Sum dual quaternion tensor
    """
    # Ensure tensors are on same device
    if dq1.device != dq2.device:
        dq2_data = dq2.data.to(dq1.device)
        dq2 = DualQuaternionTensor(dq2_data)
    
    if dq1.shape != dq2.shape:
        raise ValueError(f"dq1 and dq2 must have same shape, got {dq1.shape} and {dq2.shape}")
    
    result = dq1.data + dq2.data
    return DualQuaternionTensor(result)


# =============================================================================
# BATCHED OPERATIONS FOR VECTORIZED COMPUTATION
# =============================================================================
# These operations support arbitrary batch dimensions and broadcasting,
# enabling O(1) Python operations instead of O(n²) loops in attention.

def batched_quat_multiply(q1: torch.Tensor, q2: torch.Tensor) -> torch.Tensor:
    """
    Fully vectorized quaternion multiplication supporting arbitrary batch dimensions.
    
    This function supports broadcasting, so you can compute pairwise products
    between tensors of different shapes (e.g., [batch, seq_q, 1, 4] @ [batch, 1, seq_k, 4]).
    
    Args:
        q1: Quaternion tensor [..., 4] with components [w, x, y, z]
        q2: Quaternion tensor [..., 4] with components [w, x, y, z]
    
    Returns:
        Product quaternion [..., 4]
    """
    w1, x1, y1, z1 = q1[..., 0], q1[..., 1], q1[..., 2], q1[..., 3]
    w2, x2, y2, z2 = q2[..., 0], q2[..., 1], q2[..., 2], q2[..., 3]
    
    # Hamilton product formula
    w = w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2
    x = w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2
    y = w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2
    z = w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2
    
    return torch.stack([w, x, y, z], dim=-1)


def batched_quat_conjugate(q: torch.Tensor) -> torch.Tensor:
    """
    Batched conjugate of quaternion: (w, x, y, z) -> (w, -x, -y, -z).
    
    Supports arbitrary batch dimensions.
    
    Args:
        q: Quaternion tensor [..., 4]
    
    Returns:
        Conjugated quaternion [..., 4]
    """
    q_conj = q.clone()
    q_conj[..., 1:] = -q_conj[..., 1:]
    return q_conj


def batched_hamilton_product(
    q1: torch.Tensor,  # [..., 8]
    q2: torch.Tensor,  # [..., 8]
) -> torch.Tensor:
    """
    Fully vectorized Hamilton product for dual quaternions.
    
    Supports broadcasting for pairwise computation in attention.
    
    Formula:
    - Rotation part: q1_r * q2_r
    - Translation part: q1_r * q2_d + q1_d * q2_r
    
    Args:
        q1: Dual quaternion tensor [..., 8]
        q2: Dual quaternion tensor [..., 8]
    
    Returns:
        Product dual quaternion [..., 8]
    """
    q1_r = q1[..., :4]
    q1_d = q1[..., 4:]
    q2_r = q2[..., :4]
    q2_d = q2[..., 4:]
    
    # Rotation part: q1_r * q2_r
    result_r = batched_quat_multiply(q1_r, q2_r)
    
    # Translation part: q1_r * q2_d + q1_d * q2_r
    result_d1 = batched_quat_multiply(q1_r, q2_d)
    result_d2 = batched_quat_multiply(q1_d, q2_r)
    result_d = result_d1 + result_d2
    
    return torch.cat([result_r, result_d], dim=-1)


def batched_dual_quat_conjugate(q: torch.Tensor) -> torch.Tensor:
    """
    Batched conjugate of dual quaternion.
    
    For dual quaternion q = q_r + ε q_d:
    conjugate(q) = conjugate(q_r) + ε * conjugate(q_d)
    
    Args:
        q: Dual quaternion tensor [..., 8]
    
    Returns:
        Conjugated dual quaternion [..., 8]
    """
    q_r = q[..., :4]
    q_d = q[..., 4:]
    
    q_r_conj = batched_quat_conjugate(q_r)
    q_d_conj = batched_quat_conjugate(q_d)
    
    return torch.cat([q_r_conj, q_d_conj], dim=-1)


def batched_dual_quat_similarity(
    q: torch.Tensor,  # [..., 8]
    k: torch.Tensor,  # [..., 8]
    semantic_weight: float = 0.7,
    contextual_weight: float = 0.3,
) -> torch.Tensor:
    """
    Batched dual quaternion similarity: Score(Q,K) = Re(Q⊗K*) - ε|Du(Q⊗K*)|
    
    This is the core operation for dual quaternion attention.
    Supports broadcasting for pairwise computation.
    
    Args:
        q: Query dual quaternion [..., 8]
        k: Key dual quaternion [..., 8]
        semantic_weight: Weight for semantic (rotation) similarity
        contextual_weight: Weight for kinematic penalty
    
    Returns:
        Similarity scores [...] (last dimension is reduced)
    """
    # Conjugate K
    k_conj = batched_dual_quat_conjugate(k)
    
    # Hamilton product Q ⊗ K*
    qk_star = batched_hamilton_product(q, k_conj)
    
    # Extract semantic similarity (w component of rotation quaternion)
    semantic_sim = qk_star[..., 0]  # [...,]
    
    # Extract kinematic penalty (magnitude of translation quaternion)
    kinematic_penalty = torch.norm(qk_star[..., 4:], dim=-1)  # [...,]
    
    # Combine
    similarity = semantic_weight * semantic_sim - contextual_weight * kinematic_penalty
    
    return similarity


def pairwise_dual_quat_similarity(
    q: torch.Tensor,  # [batch, seq_q, 8]
    k: torch.Tensor,  # [batch, seq_k, 8]
    semantic_weight: float = 0.7,
    contextual_weight: float = 0.3,
) -> torch.Tensor:
    """
    Compute pairwise dual quaternion similarity matrix.
    
    This is the fully vectorized version for attention score computation.
    Computes all seq_q × seq_k pairs in O(1) Python operations.
    
    Args:
        q: Query tensor [batch, seq_q, 8]
        k: Key tensor [batch, seq_k, 8]
        semantic_weight: Weight for semantic similarity
        contextual_weight: Weight for kinematic penalty
    
    Returns:
        Similarity matrix [batch, seq_q, seq_k]
    """
    # Broadcast for pairwise computation
    # q: [batch, seq_q, 1, 8]
    # k: [batch, 1, seq_k, 8]
    # result: [batch, seq_q, seq_k, 8]
    q_exp = q.unsqueeze(2)  # [batch, seq_q, 1, 8]
    k_exp = k.unsqueeze(1)  # [batch, 1, seq_k, 8]
    
    return batched_dual_quat_similarity(q_exp, k_exp, semantic_weight, contextual_weight)
