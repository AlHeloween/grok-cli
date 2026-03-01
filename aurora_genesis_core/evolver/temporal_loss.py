"""Temporal loss functions: semantic + fractal + temporal."""

from __future__ import annotations

from typing import Optional
import torch
import torch.nn as nn
import torch.nn.functional as F

from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor


class TemporalLoss(nn.Module):
    """Combined loss: semantic + fractal + temporal.
    
    Components:
    - Semantic loss: Reconstruction/accuracy loss
    - Fractal loss: Hierarchical consistency loss
    - Temporal loss: Temporal evolution consistency
    """
    
    def __init__(
        self,
        semantic_weight: float = 1.0,
        fractal_weight: float = 0.1,
        temporal_weight: float = 0.1,
        device: Optional[str] = None,
    ):
        """Initialize temporal loss.
        
        Args:
            semantic_weight: Weight for semantic loss
            fractal_weight: Weight for fractal loss
            temporal_weight: Weight for temporal loss
            device: Device for computation
        """
        super().__init__()
        
        self.semantic_weight = float(semantic_weight)
        self.fractal_weight = float(fractal_weight)
        self.temporal_weight = float(temporal_weight)
        self.device = device or "cpu"
    
    def forward(
        self,
        predictions: torch.Tensor,
        targets: torch.Tensor,
        z: DualComplexTensor,
        z_evolved: DualComplexTensor,
        fractal_consistency: Optional[torch.Tensor] = None,
    ) -> dict[str, torch.Tensor]:
        """Compute combined loss.
        
        Args:
            predictions: Model predictions
            targets: Target values
            z: Original dual-complex tensor
            z_evolved: Evolved dual-complex tensor
            fractal_consistency: Optional fractal consistency tensor
        
        Returns:
            Dictionary with loss components
        """
        # Semantic loss
        semantic_loss = self.semantic_loss(predictions, targets)
        
        # Fractal loss
        fractal_loss = self.fractal_loss(z, fractal_consistency) if fractal_consistency is not None else torch.tensor(0.0, device=self.device)
        
        # Temporal loss (simplified - would use z_target in production)
        temporal_loss = self.temporal_loss(z, z_evolved)
        
        # Combined loss
        total_loss = (
            self.semantic_weight * semantic_loss +
            self.fractal_weight * fractal_loss +
            self.temporal_weight * temporal_loss
        )
        
        return {
            "total": total_loss,
            "semantic": semantic_loss,
            "fractal": fractal_loss,
            "temporal": temporal_loss,
        }
    
    def semantic_loss(
        self,
        predictions: torch.Tensor,
        targets: torch.Tensor,
    ) -> torch.Tensor:
        """Standard reconstruction/accuracy loss.
        
        Args:
            predictions: Model predictions
            targets: Target values
        
        Returns:
            Semantic loss
        """
        # Use cross-entropy for classification or MSE for regression
        if predictions.dim() > 1 and predictions.shape[-1] > 1:
            # Classification
            return F.cross_entropy(predictions, targets)
        else:
            # Regression
            return F.mse_loss(predictions, targets)
    
    def fractal_loss(
        self,
        z: DualComplexTensor,
        fractal_levels: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """Hierarchical consistency loss.
        
        Ensures dual-complex values are consistent across
        fractal hierarchy levels.
        
        Args:
            z: Dual-complex tensor
            fractal_levels: Optional fractal level consistency tensor
        
        Returns:
            Fractal loss
        """
        if fractal_levels is None:
            return torch.tensor(0.0, device=self.device)
        
        # Simplified: L2 distance between primal and fractal levels
        primal = z.primal
        if primal.shape != fractal_levels.shape:
            # Reshape if needed
            fractal_levels = fractal_levels.view_as(primal)
        
        return F.mse_loss(primal, fractal_levels)
    
    def temporal_loss(
        self,
        z: DualComplexTensor,
        z_evolved: DualComplexTensor,
        z_target: Optional[DualComplexTensor] = None,
    ) -> torch.Tensor:
        """Temporal evolution consistency loss.
        
        Measures how well evolved state matches target state.
        
        Args:
            z: Original dual-complex tensor
            z_evolved: Evolved dual-complex tensor
            z_target: Optional target dual-complex tensor
        
        Returns:
            Temporal loss
        """
        if z_target is not None:
            # Compare evolved to target
            primal_loss = F.mse_loss(z_evolved.primal, z_target.primal)
            dual_loss = F.mse_loss(z_evolved.dual, z_target.dual)
        else:
            # Simplified: ensure evolution is smooth
            # Loss = ||z_evolved.primal - z.primal||^2 (should be small for small dt)
            primal_loss = F.mse_loss(z_evolved.primal, z.primal)
            dual_loss = torch.tensor(0.0, device=self.device)
        
        return primal_loss + dual_loss
    
    def velocity_alignment_loss(
        self,
        z_d: torch.Tensor,
        predicted_velocity: torch.Tensor,
    ) -> torch.Tensor:
        """Ensure dual component aligns with predicted velocity.
        
        Args:
            z_d: Dual component (semantic velocity)
            predicted_velocity: Predicted velocity from screw parameters
        
        Returns:
            Velocity alignment loss
        """
        return F.mse_loss(z_d, predicted_velocity)
