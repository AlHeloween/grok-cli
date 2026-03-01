'''Loss assembly: primal + optional dual loss computation.'''

from __future__ import annotations

from typing import Optional, Union

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore
    nn = None  # type: ignore
    F = None  # type: ignore

if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.pipeline.loss_assembly requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )

from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor


class LossAssembly:
    """
    Assemble primal + optional dual loss for Aurora-Genesis training.

    Primal loss: Cross-entropy on primal logits (mandatory).
    Dual loss: MSE on dual logits vs target velocities (optional, if dual_loss_weight > 0).

    Attributes:
        primal_loss_type: Type of primal loss ("cross_entropy", "mse", etc.).
        dual_loss_weight: Weight for dual component loss (0.0 = disable).
        reduction: Reduction mode for losses ("mean", "sum", "none").
    """

    def __init__(
        self,
        primal_loss_type: str = "cross_entropy",
        dual_loss_weight: float = 0.1,
        reduction: str = "mean",
    ):
        """
        Initialize loss assembly.

        Args:
            primal_loss_type: Type of primal loss ("cross_entropy", "mse").
            dual_loss_weight: Weight for dual loss component (0.0 = disable).
            reduction: Reduction mode for losses ("mean", "sum", "none").
        """
        if primal_loss_type not in ("cross_entropy", "mse"):
            raise ValueError(f"Unsupported primal_loss_type: {primal_loss_type}")
        if reduction not in ("mean", "sum", "none"):
            raise ValueError(f"Unsupported reduction: {reduction}")
        if dual_loss_weight < 0:
            raise ValueError(f"dual_loss_weight must be >= 0, got {dual_loss_weight}")

        self.primal_loss_type = primal_loss_type
        self.dual_loss_weight = dual_loss_weight
        self.reduction = reduction

    def __call__(
        self,
        logits: Union[torch.Tensor, DualComplexTensor],
        labels: torch.Tensor,
        target_velocities: Optional[torch.Tensor] = None,
    ) -> tuple[torch.Tensor, dict[str, float]]:
        """
        Compute total loss: primal + optional dual.

        Args:
            logits: Logits tensor (batch_size, seq_len, vocab_size) or DualComplexTensor.
            labels: Target labels tensor (batch_size, seq_len) with class indices.
            target_velocities: Optional target velocities for dual loss (batch_size, seq_len, vocab_size).
                Required if dual_loss_weight > 0 and logits is DualComplexTensor with non-zero dual.

        Returns:
            Tuple of (total_loss, loss_dict) where loss_dict contains:
            - "primal_loss": Primal loss value (float).
            - "dual_loss": Dual loss value (float, 0.0 if disabled).
            - "total_loss": Total loss value (float).
        """
        if isinstance(logits, DualComplexTensor):
            logits_primal = logits.primal
            logits_dual = logits.dual
        else:
            logits_primal = logits
            logits_dual = None

        # Primal loss (mandatory)
        if self.primal_loss_type == "cross_entropy":
            # Reshape for cross-entropy: (batch*seq, vocab) vs (batch*seq,)
            batch_size, seq_len, vocab_size = logits_primal.shape
            logits_flat = logits_primal.view(batch_size * seq_len, vocab_size)
            labels_flat = labels.view(batch_size * seq_len)
            primal_loss = F.cross_entropy(logits_flat, labels_flat, reduction=self.reduction)
        elif self.primal_loss_type == "mse":
            # For MSE, convert labels to one-hot or use direct MSE
            labels_one_hot = F.one_hot(labels, num_classes=vocab_size).float()
            primal_loss = F.mse_loss(logits_primal, labels_one_hot, reduction=self.reduction)
        else:
            raise ValueError(f"Unsupported primal_loss_type: {self.primal_loss_type}")

        # Dual loss (optional)
        dual_loss = torch.tensor(0.0, device=logits_primal.device, dtype=logits_primal.dtype)
        if self.dual_loss_weight > 0 and logits_dual is not None:
            if target_velocities is None:
                # If no target velocities provided, use zero targets (encourage dual to be small)
                target_velocities = torch.zeros_like(logits_dual)
            dual_loss = F.mse_loss(logits_dual, target_velocities, reduction=self.reduction)

        # Total loss
        total_loss = primal_loss + self.dual_loss_weight * dual_loss

        # Loss dict for logging
        loss_dict = {
            "primal_loss": primal_loss.item() if primal_loss.dim() == 0 else primal_loss.mean().item(),
            "dual_loss": dual_loss.item() if dual_loss.dim() == 0 else dual_loss.mean().item(),
            "total_loss": total_loss.item() if total_loss.dim() == 0 else total_loss.mean().item(),
        }

        return total_loss, loss_dict
