"""
Dual-quaternion attention mechanism for Probe encoder.

This implements attention using dual quaternions, with separate semantic
(rotation) and contextual (translation) components.

OPTIMIZED: Uses fully vectorized tensor operations instead of O(n²) Python loops.
Expected speedup: 100-1000x for typical sequence lengths.
"""

from __future__ import annotations

import math
from typing import Optional

import torch
from torch import nn

from aurora_genesis_core.probe.dual_quaternion import (
    DualQuaternionTensor,
    hamilton_product,
    quat_multiply,
    quat_conjugate,
)


def _batched_quat_multiply(q1: torch.Tensor, q2: torch.Tensor) -> torch.Tensor:
    """
    Fully vectorized quaternion multiplication supporting arbitrary batch dimensions.
    
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


def dual_quat_attention_scores_batched(
    q: torch.Tensor,  # [batch, seq_q, 8]
    k: torch.Tensor,  # [batch, seq_k, 8]
    semantic_weight: float = 0.7,
    contextual_weight: float = 0.3,
) -> torch.Tensor:
    """
    Fully vectorized dual-quaternion attention scores computation.
    
    Uses broadcasting to compute all pairwise scores in O(1) Python operations
    instead of O(seq_q × seq_k) Python loop iterations.
    
    Formula: Score(Q,K) = semantic_weight * Re(Q⊗K*) - contextual_weight * |Du(Q⊗K*)|
    
    Args:
        q: Query tensor [batch, seq_q, 8]
        k: Key tensor [batch, seq_k, 8]
        semantic_weight: Weight for semantic (rotation) similarity
        contextual_weight: Weight for kinematic penalty (translation distance)
    
    Returns:
        Attention scores [batch, seq_q, seq_k]
    """
    batch_size, seq_q, _ = q.shape
    seq_k = k.shape[1]
    
    # Split into rotation and translation parts
    q_r = q[..., :4]  # [batch, seq_q, 4]
    q_d = q[..., 4:]  # [batch, seq_q, 4]
    k_r = k[..., :4]  # [batch, seq_k, 4]
    k_d = k[..., 4:]  # [batch, seq_k, 4]
    
    # Conjugate K: negate vector part (indices 1,2,3)
    # Use tensor operations that preserve gradients (no clone + in-place modify)
    # k_r_conj: [batch, seq_k, 4]
    k_r_conj = torch.cat([k_r[..., 0:1], -k_r[..., 1:]], dim=-1)
    k_d_conj = torch.cat([k_d[..., 0:1], -k_d[..., 1:]], dim=-1)
    
    # Broadcast for pairwise computation:
    # q_r: [batch, seq_q, 1, 4]
    # k_r_conj: [batch, 1, seq_k, 4]
    # Result: [batch, seq_q, seq_k, 4]
    q_r_exp = q_r.unsqueeze(2)  # [batch, seq_q, 1, 4]
    q_d_exp = q_d.unsqueeze(2)  # [batch, seq_q, 1, 4]
    k_r_conj_exp = k_r_conj.unsqueeze(1)  # [batch, 1, seq_k, 4]
    k_d_conj_exp = k_d_conj.unsqueeze(1)  # [batch, 1, seq_k, 4]
    
    # Compute rotation part of Q⊗K*: q_r * k_r_conj
    # result_r: [batch, seq_q, seq_k, 4]
    result_r = _batched_quat_multiply(q_r_exp, k_r_conj_exp)
    
    # Compute translation part of Q⊗K*: q_r * k_d_conj + q_d * k_r_conj
    # result_d: [batch, seq_q, seq_k, 4]
    result_d1 = _batched_quat_multiply(q_r_exp, k_d_conj_exp)
    result_d2 = _batched_quat_multiply(q_d_exp, k_r_conj_exp)
    result_d = result_d1 + result_d2
    
    # Extract semantic similarity: w component of rotation (cosine similarity)
    semantic_sim = result_r[..., 0]  # [batch, seq_q, seq_k]
    
    # Extract kinematic penalty: magnitude of translation quaternion
    kinematic_penalty = torch.norm(result_d, dim=-1)  # [batch, seq_q, seq_k]
    
    # Combine: semantic - penalty
    scores = semantic_weight * semantic_sim - contextual_weight * kinematic_penalty
    
    return scores


class DQAttention(nn.Module):
    """
    Dual-quaternion attention using proper dual quaternion inner product.
    
    OPTIMIZED: Uses fully vectorized tensor operations.
    
    Per Aurora-Genesis architecture:
    - Q/K/V are dual quaternions
    - Attention scores: Score(Q,K) = Re(Q⊗K*) + εDu(Q⊗K*)
    - Real part (Re): Semantic similarity (rotation component)
    - Dual part (Du): Kinematic penalty (translation component, filters invalid paths)
    
    This naturally filters "hallucinations" by penalizing kinematically distant
    pairs even if semantically similar (e.g., "Roman Empire" → "iPhone").
    """
    
    def __init__(
        self,
        dq_dim: int = 8,
        num_heads: int = 8,
        semantic_weight: float = 0.7,
        contextual_weight: float = 0.3,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.dq_dim = int(dq_dim)
        self.num_heads = int(num_heads)
        self.semantic_weight = float(semantic_weight)
        self.contextual_weight = float(contextual_weight)
        self.dropout = nn.Dropout(dropout) if dropout > 0 else nn.Identity()
        
        if dq_dim != 8:
            raise ValueError(f"dq_dim must be 8 for dual quaternions, got {dq_dim}")
    
    def dual_quat_similarity(
        self,
        q: DualQuaternionTensor,
        k: DualQuaternionTensor,
    ) -> torch.Tensor:
        """
        Compute dual quaternion inner product: Score(Q,K) = Re(Q⊗K*) + εDu(Q⊗K*)
        
        NOTE: This method is kept for backwards compatibility but the forward()
        method now uses the fully vectorized dual_quat_attention_scores_batched().
        
        Args:
            q: Query dual quaternion tensor [..., 8]
            k: Key dual quaternion tensor [..., 8]
        
        Returns:
            Attention scores [...,] where higher = more similar AND kinematically reachable
        """
        from aurora_genesis_core.probe.dual_quaternion import dual_quat_conjugate, hamilton_product
        
        # Step 1: Compute K* (conjugate of K)
        k_conj = dual_quat_conjugate(k)
        
        # Step 2: Compute Q⊗K* (Hamilton product)
        qk_star = hamilton_product(q, k_conj)
        
        # Step 3: Extract real part (semantic similarity from rotation)
        semantic_sim = qk_star.rotation[..., 0]  # w component
        
        # Step 4: Extract dual part (kinematic penalty from translation)
        kinematic_penalty = torch.norm(qk_star.translation, dim=-1)
        
        # Step 5: Combine
        similarity = (
            self.semantic_weight * semantic_sim -
            self.contextual_weight * kinematic_penalty
        )
        
        return similarity
    
    def forward(
        self,
        q: DualQuaternionTensor,
        k: DualQuaternionTensor,
        v: DualQuaternionTensor,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> DualQuaternionTensor:
        """
        Dual-quaternion attention forward pass (OPTIMIZED - fully vectorized).
        
        Args:
            q: Query dual quaternion tensor [batch, seq_q, 8]
            k: Key dual quaternion tensor [batch, seq_k, 8]
            v: Value dual quaternion tensor [batch, seq_k, 8]
            attention_mask: Optional attention mask [batch, seq_q, seq_k]
        
        Returns:
            Output dual quaternion tensor [batch, seq_q, 8]
        """
        # Extract raw tensors from DualQuaternionTensor
        def extract_tensor(x):
            """Recursively extract torch.Tensor from DualQuaternionTensor."""
            while isinstance(x, DualQuaternionTensor):
                x = x.data
            return x
        
        q_data = extract_tensor(q)
        k_data = extract_tensor(k)
        v_data = extract_tensor(v)
        
        batch_size, seq_q, _ = q_data.shape
        seq_k = k_data.shape[1]
        
        # ========================================
        # OPTIMIZED: Vectorized attention scores
        # ========================================
        # Old code: O(seq_q × seq_k) Python loops
        # New code: O(1) Python operations using broadcasting
        scores = dual_quat_attention_scores_batched(
            q_data, k_data,
            semantic_weight=self.semantic_weight,
            contextual_weight=self.contextual_weight,
        )  # [batch, seq_q, seq_k]
        
        # Apply attention mask if provided
        if attention_mask is not None:
            # Handle different mask shapes:
            # - [batch, seq_k] -> expand to [batch, 1, seq_k]
            # - [batch, seq_q] -> expand to [batch, seq_q, 1]
            # - [batch, seq_q, seq_k] -> use directly
            if attention_mask.dim() == 2:
                # Assume [batch, seq_k] mask (key positions)
                mask_expanded = attention_mask.unsqueeze(1)  # [batch, 1, seq_k]
            elif attention_mask.dim() == 3:
                mask_expanded = attention_mask
            else:
                raise ValueError(f"Attention mask must be 2D or 3D, got {attention_mask.dim()}D")
            
            scores = scores.masked_fill(mask_expanded == 0, float("-inf"))
        
        # Softmax
        attention_weights = torch.softmax(scores, dim=-1)  # [batch, seq_q, seq_k]
        attention_weights = self.dropout(attention_weights)
        
        # ========================================
        # OPTIMIZED: Vectorized value aggregation
        # ========================================
        # Old code: O(seq_q × seq_k) Python loops
        # New code: Single einsum operation
        # output[b, i, d] = sum_j(attention_weights[b, i, j] * v_data[b, j, d])
        output_data = torch.einsum('bqk,bkd->bqd', attention_weights, v_data)
        
        return DualQuaternionTensor(output_data)


# Legacy function kept for backwards compatibility
def dual_quat_attention_scores_vectorized(
    q: torch.Tensor,  # [batch, seq_q, 8]
    k: torch.Tensor,  # [batch, seq_k, 8]
    semantic_weight: float = 0.7,
    contextual_weight: float = 0.3,
) -> torch.Tensor:
    """
    Vectorized computation of dual-quaternion attention scores.
    
    DEPRECATED: Use dual_quat_attention_scores_batched() instead.
    This function is kept for backwards compatibility.
    """
    return dual_quat_attention_scores_batched(q, k, semantic_weight, contextual_weight)
