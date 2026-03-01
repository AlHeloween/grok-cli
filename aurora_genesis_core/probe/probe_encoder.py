"""
Probe Encoder: converts input embeddings to dual-quaternion latents.

This is the complete Probe encoder implementation (Phase 5.6) that uses
DQLinear and DQAttention layers to encode inputs into dual-quaternion space.
"""

from __future__ import annotations

from typing import Optional

import torch
from torch import nn

from aurora_genesis_core.probe.dq_attention import DQAttention
from aurora_genesis_core.probe.dq_linear import DQLinear
from aurora_genesis_core.probe.dual_quaternion import (
    DualQuaternionTensor,
    dual_quat_normalize,
    dual_quat_add,
)


class ProbeEncoderLayer(nn.Module):
    """
    Single layer of Probe encoder.
    
    Architecture:
    - DQLinear (input projection)
    - DQAttention (self-attention)
    - DQLinear (output projection)
    - Normalization (unit dual quaternion)
    """
    
    def __init__(
        self,
        hidden_size: int,
        num_heads: int = 8,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.hidden_size = int(hidden_size)
        self.num_heads = int(num_heads)
        
        # Input projection: [hidden_size, 8] -> [hidden_size, 8]
        self.input_proj = DQLinear(
            in_features=hidden_size,
            out_features=hidden_size,
            bias=True,
        )
        
        # Self-attention
        self.attention = DQAttention(
            dq_dim=8,
            num_heads=num_heads,
            dropout=dropout,
        )
        
        # Output projection: [hidden_size, 8] -> [hidden_size, 8]
        self.output_proj = DQLinear(
            in_features=hidden_size,
            out_features=hidden_size,
            bias=True,
        )
        
        self.dropout = nn.Dropout(dropout) if dropout > 0 else nn.Identity()
    
    def forward(
        self,
        x: DualQuaternionTensor,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> DualQuaternionTensor:
        """
        Forward pass through encoder layer.
        
        Args:
            x: Input dual quaternion tensor [batch, seq, hidden_size, 8]
            attention_mask: Optional attention mask [batch, seq, seq]
        
        Returns:
            Output dual quaternion tensor [batch, seq, hidden_size, 8]
        """
        # Input projection
        x_proj = self.input_proj(x)  # [batch, seq, hidden_size, 8]
        
        # Self-attention (flatten hidden_size dimension for attention)
        batch_size, seq_len, hidden_size, dq_dim = x_proj.shape
        x_flat = x_proj.data.view(batch_size, seq_len, hidden_size * dq_dim)  # [batch, seq, hidden_size*8]
        x_flat_dq = DualQuaternionTensor(x_flat.view(batch_size, seq_len, -1, 8))  # [batch, seq, hidden_size, 8]
        
        # For attention, we need to reshape to [batch, seq, 8] per head
        # Simplified: use first hidden dimension for attention
        x_attn = DualQuaternionTensor(x_flat_dq.data[:, :, 0, :])  # [batch, seq, 8]
        attn_out = self.attention(x_attn, x_attn, x_attn, attention_mask)  # [batch, seq, 8]
        
        # Expand back to [batch, seq, hidden_size, 8]
        attn_out_expanded = attn_out.data.unsqueeze(2).expand(-1, -1, hidden_size, -1)
        x_attn_full = DualQuaternionTensor(attn_out_expanded)
        
        # Residual connection (component-wise addition)
        x_res_data = x_proj.data + x_attn_full.data
        x_res = DualQuaternionTensor(x_res_data)
        
        # Output projection
        x_out = self.output_proj(x_res)  # [batch, seq, hidden_size, 8]
        
        # Normalize to unit dual quaternion
        x_norm = dual_quat_normalize(x_out)
        
        # Dropout
        x_final = DualQuaternionTensor(self.dropout(x_norm.data))
        
        return x_final


class ProbeEncoder(nn.Module):
    """
    Probe encoder: converts input embeddings to dual-quaternion latents.
    
    Architecture:
    - Input embedding layer (standard)
    - Projection to dual quaternion space
    - Multiple ProbeEncoderLayer layers
    - Output projection
    """
    
    def __init__(
        self,
        vocab_size: int,
        hidden_size: int,
        num_layers: int,
        num_heads: int = 8,
        dq_dim: int = 8,
        max_seq_length: int = 512,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.vocab_size = int(vocab_size)
        self.hidden_size = int(hidden_size)
        self.num_layers = int(num_layers)
        self.num_heads = int(num_heads)
        self.dq_dim = int(dq_dim)
        self.max_seq_length = int(max_seq_length)
        
        if dq_dim != 8:
            raise ValueError(f"dq_dim must be 8 for dual quaternions, got {dq_dim}")
        
        # Input embedding (standard)
        self.embedding = nn.Embedding(vocab_size, hidden_size)
        
        # Linear projection from embedding to dual quaternion space
        # Maps [hidden_size] -> [8] for each position
        self.embed_to_dq = nn.Linear(hidden_size, 8)
        
        # Encoder layers
        self.layers = nn.ModuleList([
            ProbeEncoderLayer(
                hidden_size=hidden_size,
                num_heads=num_heads,
                dropout=dropout,
            )
            for _ in range(num_layers)
        ])
        
        # Output projection: [hidden_size, 8] -> [hidden_size, 8]
        self.output_proj = DQLinear(
            in_features=hidden_size,
            out_features=hidden_size,
            bias=True,
        )
        
        self.dropout = nn.Dropout(dropout) if dropout > 0 else nn.Identity()
    
    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
    ) -> DualQuaternionTensor:
        """
        Forward pass through Probe encoder.
        
        Args:
            input_ids: Input token IDs [batch, seq]
            attention_mask: Optional attention mask [batch, seq]
        
        Returns:
            Output dual quaternion tensor [batch, seq, hidden_size, 8]
        """
        batch_size, seq_len = input_ids.shape
        
        # Embedding: [batch, seq] -> [batch, seq, hidden_size]
        x_emb = self.embedding(input_ids)  # [batch, seq, hidden_size]
        
        # Project embedding to dual quaternion space using learned projection
        # [batch, seq, hidden_size] -> [batch, seq, hidden_size, 8]
        # Apply linear projection to each position
        x_dq_base = self.embed_to_dq(x_emb)  # [batch, seq, 8]
        
        # Expand to [batch, seq, hidden_size, 8] by broadcasting
        x_dq_data = x_dq_base.unsqueeze(2).expand(-1, -1, self.hidden_size, -1)  # [batch, seq, hidden_size, 8]
        
        # Add position-dependent variation using the embedding values
        # This ensures different hidden dimensions get slightly different values
        position_variation = x_emb.unsqueeze(-1) * 0.01  # [batch, seq, hidden_size, 1]
        x_dq_data = x_dq_data + position_variation.expand(-1, -1, -1, 8)
        
        # Normalize the rotation part to ensure valid dual quaternion
        x_dq_rot = x_dq_data[..., :4]
        x_dq_trans = x_dq_data[..., 4:]
        rot_norm = torch.norm(x_dq_rot, dim=-1, keepdim=True)
        x_dq_rot_norm = x_dq_rot / (rot_norm + 1e-8)
        
        x_dq_data = torch.cat([x_dq_rot_norm, x_dq_trans], dim=-1)
        x_dq = DualQuaternionTensor(x_dq_data)
        
        # Apply dropout
        x_dq = DualQuaternionTensor(self.dropout(x_dq.data))
        
        # Pass through encoder layers
        for layer in self.layers:
            x_dq = layer(x_dq, attention_mask)
        
        # Output projection
        x_out = self.output_proj(x_dq)  # [batch, seq, hidden_size, 8]
        
        return x_out


def dual_quat_add(dq1: DualQuaternionTensor, dq2: DualQuaternionTensor) -> DualQuaternionTensor:
    """Add two dual quaternions component-wise."""
    from aurora_genesis_core.probe.dual_quaternion import dual_quat_add as _dual_quat_add
    return _dual_quat_add(dq1, dq2)
