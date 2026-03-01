"""Screw theory module for temporal evolution.

Screw motion: rotation around axis + translation along axis
Uses screw parameters (omega, v) to represent temporal evolution.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import torch
import torch.nn.functional as F

# Note: Dual quaternion operations are handled via torch tensors directly


@dataclass
class ScrewParameters:
    """Screw parameters for temporal evolution.
    
    Screw motion: rotation around axis + translation along axis
    - omega: Angular velocity (rotation axis + magnitude) [batch, seq, 3] or [3]
    - v: Linear velocity (translation along axis) [batch, seq, 3] or [3]
    """
    omega: torch.Tensor  # Angular velocity vector
    v: torch.Tensor      # Linear velocity vector
    
    def __post_init__(self):
        """Validate tensor shapes."""
        if self.omega.shape != self.v.shape:
            raise ValueError(f"omega and v must have same shape, got {self.omega.shape} and {self.v.shape}")


def compute_screw_motion(
    screw_params: ScrewParameters,
    dt: torch.Tensor,  # Time step
    device: Optional[str] = None,
) -> torch.Tensor:
    """Compute screw motion transformation.
    
    Args:
        screw_params: Screw parameters (omega, v)
        dt: Time step (scalar or tensor matching omega/v batch dims)
        device: Device for computation
    
    Returns:
        Dual quaternion transformation [batch, seq, 8] or [8]
    """
    omega = screw_params.omega
    v = screw_params.v
    
    if device is None:
        device = omega.device
    
    # Ensure dt is broadcastable
    if isinstance(dt, (int, float)):
        dt = torch.tensor(dt, dtype=omega.dtype, device=device)
    
    # Compute rotation quaternion from omega
    # Formula: q = exp(omega * dt / 2)
    # For small angles: q ≈ [1, omega*dt/2] (axis-angle to quaternion)
    omega_dt = omega * dt.unsqueeze(-1) if dt.dim() < omega.dim() else omega * dt
    
    # Compute rotation angle and axis
    omega_norm = torch.norm(omega_dt, dim=-1, keepdim=True)
    omega_axis = omega_dt / (omega_norm + 1e-8)
    
    # Convert to quaternion (axis-angle representation)
    half_angle = omega_norm / 2.0
    cos_half = torch.cos(half_angle)
    sin_half = torch.sin(half_angle)
    
    # Quaternion: [w, x, y, z] = [cos(θ/2), sin(θ/2) * axis]
    q_w = cos_half.squeeze(-1)
    q_xyz = sin_half * omega_axis
    
    # Stack to quaternion [..., 4]
    if q_w.dim() == 0:
        q_real = torch.cat([q_w.unsqueeze(0), q_xyz.flatten()])
    else:
        q_real = torch.cat([q_w.unsqueeze(-1), q_xyz], dim=-1)
    
    # Compute translation quaternion
    # Translation: t = v * dt
    t = v * dt.unsqueeze(-1) if dt.dim() < v.dim() else v * dt
    
    # Dual quaternion: real part = rotation, dual part = 0.5 * t * q_real
    # Simplified: create dual quaternion from rotation and translation
    q_dual_w = torch.zeros_like(q_w)
    q_dual_xyz = 0.5 * t
    
    if q_dual_w.dim() == 0:
        q_dual = torch.cat([q_dual_w.unsqueeze(0), q_dual_xyz.flatten()])
    else:
        q_dual = torch.cat([q_dual_w.unsqueeze(-1), q_dual_xyz], dim=-1)
    
    # Combine into dual quaternion [..., 8]
    dq = torch.cat([q_real, q_dual], dim=-1)
    
    return dq


def screw_to_dual_quaternion(
    omega: torch.Tensor,
    v: torch.Tensor,
    dt: torch.Tensor,
    device: Optional[str] = None,
) -> torch.Tensor:
    """Convert screw parameters to dual quaternion transformation.
    
    Args:
        omega: Angular velocity [batch, seq, 3] or [3]
        v: Linear velocity [batch, seq, 3] or [3]
        dt: Time step
        device: Device for computation
    
    Returns:
        Dual quaternion [batch, seq, 8] or [8]
    """
    screw_params = ScrewParameters(omega=omega, v=v)
    return compute_screw_motion(screw_params, dt, device=device)


def dual_quaternion_to_screw(
    dq: torch.Tensor,
    dt: torch.Tensor,
    device: Optional[str] = None,
) -> ScrewParameters:
    """Extract screw parameters from dual quaternion transformation.
    
    Args:
        dq: Dual quaternion [batch, seq, 8] or [8]
        dt: Time step
        device: Device for computation
    
    Returns:
        ScrewParameters (omega, v)
    """
    if device is None:
        device = dq.device
    
    # Ensure dt is broadcastable
    if isinstance(dt, (int, float)):
        dt = torch.tensor(dt, dtype=dq.dtype, device=device)
    
    # Extract real and dual parts
    if dq.dim() == 1:
        q_real = dq[:4]  # [w, x, y, z]
        q_dual = dq[4:]  # [w, x, y, z]
    else:
        q_real = dq[..., :4]
        q_dual = dq[..., 4:]
    
    # Extract rotation axis and angle from quaternion
    # q = [cos(θ/2), sin(θ/2) * axis]
    q_w = q_real[..., 0]
    q_xyz = q_real[..., 1:4]
    
    # Compute angle
    half_angle = torch.acos(torch.clamp(q_w, -1.0, 1.0))
    angle = 2.0 * half_angle
    
    # Compute axis
    sin_half = torch.sin(half_angle)
    axis = q_xyz / (sin_half.unsqueeze(-1) + 1e-8)
    
    # Angular velocity: omega = angle * axis / dt
    omega = (angle.unsqueeze(-1) * axis) / (dt.unsqueeze(-1) if dt.dim() < angle.dim() else dt + 1e-8)
    
    # Extract translation from dual part
    # q_dual = 0.5 * t * q_real
    # t = 2 * q_dual / q_real (simplified)
    # For small translations: t ≈ 2 * q_dual[1:4]
    t = 2.0 * q_dual[..., 1:4]
    
    # Linear velocity: v = t / dt
    v = t / (dt.unsqueeze(-1) if dt.dim() < t.dim() else dt + 1e-8)
    
    return ScrewParameters(omega=omega, v=v)


def apply_screw_motion(
    state: torch.Tensor,
    screw_motion: torch.Tensor,  # Dual quaternion
    device: Optional[str] = None,
) -> torch.Tensor:
    """Apply screw motion to state.
    
    Args:
        state: State tensor [batch, seq, dim] or [dim]
        screw_motion: Dual quaternion transformation [batch, seq, 8] or [8]
        device: Device for computation
    
    Returns:
        Transformed state [batch, seq, dim] or [dim]
    """
    if device is None:
        device = state.device
    
    # Convert state to dual quaternion if needed
    # For now, simplified: apply rotation part only
    if screw_motion.dim() == 1:
        q_real = screw_motion[:4]
    else:
        q_real = screw_motion[..., :4]
    
    # Apply rotation (simplified - would use proper quaternion multiplication)
    # For now, return state (would apply proper transformation in production)
    return state
