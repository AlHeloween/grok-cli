"""Hidden-state -> SE(3) dual-quaternion projection (HF path integration)."""

from __future__ import annotations

try:
    import torch
    import torch.nn as nn
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore
    nn = None  # type: ignore

if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.pipeline.pose_projection requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )


def _quat_mul(q1: torch.Tensor, q2: torch.Tensor) -> torch.Tensor:
    w1, x1, y1, z1 = q1[..., 0], q1[..., 1], q1[..., 2], q1[..., 3]
    w2, x2, y2, z2 = q2[..., 0], q2[..., 1], q2[..., 2], q2[..., 3]
    w = w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2
    x = w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2
    y = w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2
    z = w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2
    return torch.stack([w, x, y, z], dim=-1)


class HiddenToDualQuaternion(nn.Module):
    """
    Project hidden states (B, T, H) to valid dual quaternions (B, T, 8).

    Construction:
    - Predict rotation quaternion qr (4) and translation vector t (3).
    - Normalize qr to unit quaternion.
    - Convert translation to dual part: qd = 0.5 * (0, t) * qr
      This satisfies the dual-quaternion rigid motion constraint.
    """

    def __init__(self, hidden_dim: int) -> None:
        super().__init__()
        if hidden_dim < 1:
            raise ValueError(f"hidden_dim must be >= 1, got {hidden_dim}")
        self.proj = nn.Linear(int(hidden_dim), 7, bias=True)

    def forward(self, hidden_states: torch.Tensor) -> torch.Tensor:
        if hidden_states.ndim != 3:
            raise ValueError(f"Expected hidden_states (B,T,H), got {tuple(hidden_states.shape)}")

        x = self.proj(hidden_states.to(dtype=torch.float32))
        qr_raw = x[..., :4]
        t = x[..., 4:7]

        qr = qr_raw / (torch.norm(qr_raw, dim=-1, keepdim=True) + 1e-8)
        t_quat = torch.cat([torch.zeros_like(t[..., :1]), t], dim=-1)
        qd = 0.5 * _quat_mul(t_quat, qr)

        dq = torch.cat([qr, qd], dim=-1)
        return dq.to(dtype=hidden_states.dtype)

