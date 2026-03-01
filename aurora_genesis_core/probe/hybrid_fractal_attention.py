"""Hybrid Fractal Attention: Combining local window + global fractal context.

Implements Navigation paradigm attention:
- Clocal: Last W tokens with standard dense attention (O(W·Q))
- Cglobal: Fractal memory via velocity-based drill-down (O(K·log N))
- Combined: O(W·Q) + O(K·log N) instead of O(Q²)
"""

from __future__ import annotations

from typing import Optional
import torch
from torch import nn

from aurora_genesis_core.probe.dual_quaternion import DualQuaternionTensor
from aurora_genesis_core.probe.dq_attention import DQAttention
from aurora_genesis_core.memory.fractal_context_engine import FractalContextEngine


class HybridFractalAttention(nn.Module):
    """
    Hybrid Fractal Attention combining local window + global fractal context.
    
    Architecture:
    - Local Attention: Standard dense attention on last W tokens
    - Global Attention: Fractal memory retrieval via velocity-based drill-down
    - Combination: Weighted combination of local + global contexts
    
    Scaling: O(W·Q) + O(K·log N) instead of O(Q²)
    """
    
    def __init__(
        self,
        dq_dim: int = 8,
        num_heads: int = 8,
        window_size: int = 2048,
        local_weight: float = 0.7,
        global_weight: float = 0.3,
        semantic_weight: float = 0.7,
        contextual_weight: float = 0.3,
        dropout: float = 0.1,
        fractal_engine: Optional[FractalContextEngine] = None,
        device: Optional[str] = None,
    ) -> None:
        """
        Initialize Hybrid Fractal Attention.
        
        Args:
            dq_dim: Dual quaternion dimension (must be 8)
            num_heads: Number of attention heads
            window_size: Local context window size (W)
            local_weight: Weight for local attention output
            global_weight: Weight for global fractal attention output
            semantic_weight: Weight for semantic similarity in DQ attention
            contextual_weight: Weight for kinematic penalty in DQ attention
            dropout: Dropout probability
            fractal_engine: Optional FractalContextEngine (if None, will be created)
        """
        super().__init__()
        
        self.dq_dim = int(dq_dim)
        self.num_heads = int(num_heads)
        self.window_size = int(window_size)
        self.local_weight = float(local_weight)
        self.global_weight = float(global_weight)
        
        if dq_dim != 8:
            raise ValueError(f"dq_dim must be 8 for dual quaternions, got {dq_dim}")
        
        # Local attention (standard DQ attention on window)
        self.local_attention = DQAttention(
            dq_dim=dq_dim,
            num_heads=num_heads,
            semantic_weight=semantic_weight,
            contextual_weight=contextual_weight,
            dropout=dropout,
        )
        
        # Global attention (fractal memory retrieval)
        self.fractal_engine = fractal_engine
        
        # Cross-attention between query and global context
        self.global_cross_attention = DQAttention(
            dq_dim=dq_dim,
            num_heads=num_heads,
            semantic_weight=semantic_weight,
            contextual_weight=contextual_weight,
            dropout=dropout,
        )
        
        # Output projection
        self.output_proj = nn.Linear(dq_dim, dq_dim)
        self.dropout = nn.Dropout(dropout) if dropout > 0 else nn.Identity()
        
        # Store device for later use
        self._device = device
        if device is not None:
            self.to(device=device)
        else:
            # Auto-detect device from first input if not specified
            self._device = None
    
    def forward(
        self,
        q: DualQuaternionTensor,
        k: DualQuaternionTensor,
        v: DualQuaternionTensor,
        attention_mask: Optional[torch.Tensor] = None,
        fractal_engine: Optional[FractalContextEngine] = None,
    ) -> DualQuaternionTensor:
        """
        Hybrid fractal attention forward pass.
        
        Args:
            q: Query dual quaternion tensor [batch, seq_q, 8]
            k: Key dual quaternion tensor [batch, seq_k, 8]
            v: Value dual quaternion tensor [batch, seq_k, 8]
            attention_mask: Optional attention mask [batch, seq_q, seq_k]
            fractal_engine: Optional FractalContextEngine (overrides self.fractal_engine)
        
        Returns:
            Output dual quaternion tensor [batch, seq_q, 8]
        """
        batch_size, seq_q, _ = q.shape
        seq_k = k.shape[1]
        
        # Use provided fractal engine or self.fractal_engine
        engine = fractal_engine if fractal_engine is not None else self.fractal_engine
        
        # 1. Local Attention: Standard dense attention on last W tokens
        # Extract window: last W tokens
        w = min(self.window_size, seq_k)
        k_window = DualQuaternionTensor(k.data[:, -w:, :])  # [batch, w, 8]
        v_window = DualQuaternionTensor(v.data[:, -w:, :])  # [batch, w, 8]
        
        # Create window attention mask if provided
        window_mask = None
        if attention_mask is not None:
            window_mask = attention_mask[:, :, -w:]  # [batch, seq_q, w]
        
        # Local attention on window
        local_out = self.local_attention(
            q,
            DualQuaternionTensor(k_window),
            DualQuaternionTensor(v_window),
            attention_mask=window_mask,
        )  # [batch, seq_q, 8]
        
        # 2. Global Attention: Fractal memory retrieval
        global_out = None
        if engine is not None:
            # Extract query embedding (use last token's query)
            query_dq = DualQuaternionTensor(q.data[:, -1, :])  # [batch, 8]
            
            # Get hybrid context: Clocal + Cglobal
            # For now, we'll use the query itself as the "local tokens" reference
            # In production, this would be the actual local context tokens
            Clocal, Cglobal = engine.get_context(query_dq)
            
            # If we have global context, compute cross-attention
            if Cglobal.shape[0] > 0:
                # Expand Cglobal to batch dimension
                # Cglobal: [K, 8] -> [batch, K, 8]
                Cglobal_batch = Cglobal.unsqueeze(0).expand(batch_size, -1, -1)
                Cglobal_dq = DualQuaternionTensor(Cglobal_batch)
                
                # Cross-attention: query attends to global context
                global_out = self.global_cross_attention(
                    q,
                    Cglobal_dq,
                    Cglobal_dq,  # Use same as K and V
                )  # [batch, seq_q, 8]
            else:
                # No global context, use zero tensor
                global_out = DualQuaternionTensor(
                    torch.zeros_like(q.data, device=q.device, dtype=q.dtype)
                )
        else:
            # No fractal engine, use zero tensor
            global_out = DualQuaternionTensor(
                torch.zeros_like(q.data, device=q.device, dtype=q.dtype)
            )
        
        # 3. Combine local + global
        # Weighted combination
        combined = DualQuaternionTensor(
            self.local_weight * local_out.data + self.global_weight * global_out.data
        )  # [batch, seq_q, 8]
        
        # 4. Output projection
        output = DualQuaternionTensor(
            self.output_proj(combined.data)
        )
        
        # 5. Apply dropout
        output = DualQuaternionTensor(
            self.dropout(output.data)
        )
        
        return output
    
    def set_fractal_engine(self, fractal_engine: FractalContextEngine) -> None:
        """
        Set fractal context engine.
        
        Args:
            fractal_engine: FractalContextEngine instance
        """
        self.fractal_engine = fractal_engine
