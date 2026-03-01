"""Temporal evolution on dual component via screw theory."""

from __future__ import annotations

from typing import Optional
import torch
import torch.nn as nn

from aurora_genesis_core.evolver.screw_theory import (
    ScrewParameters,
    compute_screw_motion,
    apply_screw_motion,
)
from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor, _stack


class TemporalEvolver(nn.Module):
    """Learn temporal evolution on dual component via screw theory.
    
    Architecture:
    - Input: Dual-complex tensor z = z_p + ε z_d
    - Predict screw parameters (omega, v) from z_p, z_d
    - Evolve z_p forward in time using screw motion
    - Update z_d based on evolution
    """
    
    def __init__(
        self,
        hidden_dim: int,
        screw_dim: int = 6,  # 3 for omega + 3 for v
        device: Optional[str] = None,
    ):
        """Initialize temporal evolver.
        
        Args:
            hidden_dim: Hidden dimension (dimension of z_p and z_d)
            screw_dim: Dimension of screw parameters (6 = 3 omega + 3 v)
            device: Device for computation
        """
        super().__init__()
        
        self.hidden_dim = int(hidden_dim)
        self.screw_dim = int(screw_dim)
        self.device = device or "cpu"
        
        # Screw parameter prediction network
        # Input: z_p + z_d concatenated
        self.screw_predictor = nn.Sequential(
            nn.Linear(self.hidden_dim * 2, self.hidden_dim),
            nn.ReLU(),
            nn.Linear(self.hidden_dim, self.screw_dim),
        ).to(device=self.device)
    
    def forward(
        self,
        z: DualComplexTensor,
        dt: torch.Tensor,  # Time step
    ) -> DualComplexTensor:
        """Evolve dual-complex tensor forward in time.
        
        Args:
            z: Dual-complex tensor (z_p + ε z_d)
            dt: Time step (scalar or tensor)
        
        Returns:
            Evolved dual-complex tensor
        """
        # Ensure tensors are on correct device
        z_primal = z.primal.to(device=self.device)
        z_dual = z.dual.to(device=self.device)
        
        if isinstance(dt, (int, float)):
            dt = torch.tensor(dt, dtype=z_primal.dtype, device=self.device)
        else:
            dt = dt.to(device=self.device)
        
        # 1. Predict screw parameters
        screw_params = self.predict_screw(z_primal, z_dual)
        
        # 2. Compute screw motion
        screw_motion = compute_screw_motion(screw_params, dt, device=self.device)
        
        # 3. Apply motion to primal
        z_p_evolved = self._apply_motion_to_primal(z_primal, screw_motion)
        
        # 4. Update dual based on evolution
        # z_d = d/dt z_p ≈ (z_p_evolved - z_p) / dt
        if dt.dim() == 0:
            z_d_evolved = (z_p_evolved - z_primal) / (dt + 1e-8)
        else:
            # Broadcast dt if needed
            while dt.dim() < z_p_evolved.dim():
                dt = dt.unsqueeze(-1)
            z_d_evolved = (z_p_evolved - z_primal) / (dt + 1e-8)
        
        # Create evolved dual-complex tensor
        return DualComplexTensor(_stack(z_p_evolved, z_d_evolved))
    
    def predict_screw(
        self,
        z_primal: torch.Tensor,
        z_dual: torch.Tensor,
    ) -> ScrewParameters:
        """Predict screw parameters from dual-complex state.
        
        Args:
            z_primal: Primal component [batch, seq, dim] or [dim]
            z_dual: Dual component [batch, seq, dim] or [dim]
        
        Returns:
            ScrewParameters (omega, v)
        """
        # Concatenate primal and dual
        if z_primal.dim() == 1:
            # [dim] -> [1, dim]
            z_primal = z_primal.unsqueeze(0)
            z_dual = z_dual.unsqueeze(0)
        
        # Flatten if needed
        batch_size = z_primal.shape[0]
        seq_len = z_primal.shape[1] if z_primal.dim() > 2 else 1
        dim = z_primal.shape[-1]
        
        # Reshape to [batch*seq, dim]
        z_primal_flat = z_primal.reshape(-1, dim)
        z_dual_flat = z_dual.reshape(-1, dim)
        
        # Concatenate
        z_concat = torch.cat([z_primal_flat, z_dual_flat], dim=-1)  # [batch*seq, dim*2]
        
        # Predict screw parameters
        screw_flat = self.screw_predictor(z_concat)  # [batch*seq, 6]
        
        # Split into omega and v
        omega_flat = screw_flat[:, :3]  # [batch*seq, 3]
        v_flat = screw_flat[:, 3:]      # [batch*seq, 3]
        
        # Reshape back
        if seq_len > 1:
            omega = omega_flat.reshape(batch_size, seq_len, 3)
            v = v_flat.reshape(batch_size, seq_len, 3)
        else:
            omega = omega_flat.reshape(batch_size, 3)
            v = v_flat.reshape(batch_size, 3)
        
        return ScrewParameters(omega=omega, v=v)
    
    def _apply_motion_to_primal(
        self,
        z_primal: torch.Tensor,
        screw_motion: torch.Tensor,  # Dual quaternion [..., 8]
    ) -> torch.Tensor:
        """Apply screw motion to primal component.
        
        Args:
            z_primal: Primal component [batch, seq, dim] or [dim]
            screw_motion: Dual quaternion transformation [batch, seq, 8] or [8]
        
        Returns:
            Evolved primal component
        """
        # Simplified: extract rotation quaternion and apply
        # In production, would use proper dual quaternion multiplication
        
        if screw_motion.dim() == 1:
            q_real = screw_motion[:4]  # [w, x, y, z]
        else:
            q_real = screw_motion[..., :4]  # [..., w, x, y, z]
        
        # For now, simplified transformation
        # In production, would apply proper quaternion rotation
        # For small rotations, approximate as identity + small rotation
        return z_primal  # Simplified - would apply proper transformation
    
    def extrapolate(
        self,
        z: DualComplexTensor,
        future_times: torch.Tensor,  # [n_future] or scalar
    ) -> DualComplexTensor:
        """Extrapolate dual-complex tensor to future times.
        
        Args:
            z: Current dual-complex tensor
            future_times: Future time points [n_future] or scalar
        
        Returns:
            Extrapolated dual-complex tensor
        """
        if isinstance(future_times, (int, float)):
            future_times = torch.tensor([future_times], device=self.device)
        
        # Evolve to each future time
        evolved_states = []
        for t in future_times:
            z_evolved = self(z, dt=t)
            evolved_states.append(z_evolved)
        
        # Return last state (or could return all states)
        return evolved_states[-1] if evolved_states else z
