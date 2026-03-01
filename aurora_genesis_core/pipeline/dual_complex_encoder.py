'''Dual-complex encoder: encode input tokens as dual-complex tensors with optional timestamp injection.'''

from __future__ import annotations

from typing import Optional

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    import math
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore
    nn = None  # type: ignore
    F = None  # type: ignore
    math = None  # type: ignore

if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.pipeline.dual_complex_encoder requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )

from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor, _stack


class DualComplexEncoder(nn.Module):
    """
    Encode input tokens as dual-complex tensors.

    Primal component: token embedding (state).
    Dual component: semantic velocity (optional timestamp-based phase shifts).

    Attributes:
        vocab_size: Vocabulary size.
        hidden_size: Hidden dimension size.
        use_timestamp_injection: If True, inject timestamps as dual phase shifts.
    """

    def __init__(
        self,
        vocab_size: int,
        hidden_size: int,
        use_timestamp_injection: bool = False,
        device: Optional[str] = None,
    ):
        """
        Initialize dual-complex encoder.

        Args:
            vocab_size: Vocabulary size.
            hidden_size: Hidden dimension size.
            use_timestamp_injection: If True, inject timestamps as dual phase shifts.
            device: PyTorch device ('cuda', 'cpu', etc.). Defaults to 'cuda' if available.
        """
        super().__init__()
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"

        self.vocab_size = vocab_size
        self.hidden_size = hidden_size
        self.use_timestamp_injection = use_timestamp_injection
        self.device = device

        # Standard embedding layer (will wrap in DualComplexTensor)
        # For MVP, use standard nn.Embedding and convert to dual-complex
        self.embedding = nn.Embedding(vocab_size, hidden_size)
        self.embedding = self.embedding.to(device)

    def forward(
        self,
        input_ids: torch.Tensor,
        timestamps: Optional[torch.Tensor] = None,
    ) -> DualComplexTensor:
        """
        Encode input tokens as dual-complex tensors.

        Args:
            input_ids: Token IDs tensor (batch_size, seq_len) with integer indices.
            timestamps: Optional timestamps tensor (batch_size, seq_len) with float values.
                Required if use_timestamp_injection=True.

        Returns:
            Dual-complex embeddings tensor (batch_size, seq_len, hidden_size).
        """
        batch_size, seq_len = input_ids.shape
        device = input_ids.device

        # Standard embedding lookup
        embedded_primal = self.embedding(input_ids)  # (batch, seq, hidden_size)

        # Initialize dual component as zeros (will be updated by timestamp injection if enabled)
        embedded_dual = torch.zeros_like(embedded_primal)

        # Optional timestamp injection: add phase shift to dual component
        if self.use_timestamp_injection:
            if timestamps is None:
                raise ValueError("timestamps required when use_timestamp_injection=True")
            
            # Map timestamps to phase shifts: phase = 2π * f * t
            # Use a learnable or fixed frequency (for now, use fixed f=1.0)
            frequency = 1.0
            phase = 2 * math.pi * frequency * timestamps  # (batch, seq)
            phase = phase.unsqueeze(-1)  # (batch, seq, 1)

            # Add phase shift to dual component: dual = dual + sin(phase) * embedding_norm
            # This creates a temporal velocity component
            embedding_norm = torch.norm(embedded_primal, dim=-1, keepdim=True)  # (batch, seq, 1)
            dual_phase_shift = torch.sin(phase) * embedding_norm * 0.1  # Scale by 0.1 for stability

            # Update dual component
            embedded_dual = embedded_dual + dual_phase_shift

        # Wrap in DualComplexTensor: stack primal and dual along last dimension
        # DualComplexTensor expects data with last dim=2: [primal, dual]
        embedded = DualComplexTensor(_stack(embedded_primal, embedded_dual))
        return embedded
