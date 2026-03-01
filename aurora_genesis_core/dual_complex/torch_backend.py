"""
PyTorch backend for Dual-Complex (Dual-Phasor) tensors.

Representation (document-aligned):
- A dual-complex tensor is stored as a complex PyTorch tensor with last dim = 2:
  - `[..., 0]` = primal complex
  - `[..., 1]` = dual complex

Algebra:
- (A + εB)(C + εD) = AC + ε(AD + BC), with ε^2 = 0
- Inverse (commutative dual numbers over complex, for A != 0):
  (A + εB)^-1 = A^-1 + ε(-B * A^-2)

Note: This module requires `torch`. It is intentionally NOT imported by default
from `aurora_genesis_core.dual_complex` to keep base imports working in
non-Torch environments.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Union

import torch
from torch import nn


def _stack(primal: torch.Tensor, dual: torch.Tensor) -> torch.Tensor:
    return torch.stack([primal, dual], dim=-1)


@dataclass(frozen=True)
class DualComplexTensor:
    """A thin wrapper around a `torch.Tensor` with last dim=2 (primal, dual)."""

    data: torch.Tensor

    @property
    def primal(self) -> torch.Tensor:
        return self.data[..., 0]

    @property
    def dual(self) -> torch.Tensor:
        return self.data[..., 1]

    def conj(self) -> DualComplexTensor:
        return DualComplexTensor(_stack(self.primal.conj(), self.dual.conj()))

    def __add__(self, other: DualComplexTensor) -> DualComplexTensor:
        return DualComplexTensor(self.data + other.data)

    def __mul__(self, other: DualComplexTensor) -> DualComplexTensor:
        # (A + εB)(C + εD) = AC + ε(AD + BC)
        ap, ad = self.primal, self.dual
        bp, bd = other.primal, other.dual
        primal = ap * bp
        dual = ap * bd + ad * bp
        return DualComplexTensor(_stack(primal, dual))

    def reciprocal(self) -> DualComplexTensor:
        # (A + εB)^-1 = A^-1 + ε(-B * A^-2), for A != 0
        ap, ad = self.primal, self.dual
        ap_inv = 1.0 / ap
        dual = -(ad * (ap_inv * ap_inv))
        return DualComplexTensor(_stack(ap_inv, dual))


def dual_tanh(z: DualComplexTensor) -> DualComplexTensor:
    p = torch.tanh(z.primal)
    dp = 1.0 - p * p
    d = z.dual * dp
    return DualComplexTensor(_stack(p, d))


def dual_sigmoid(z: DualComplexTensor) -> DualComplexTensor:
    # sigmoid(z) = 1 / (1 + exp(-z))
    p = 1.0 / (1.0 + torch.exp(-z.primal))
    dp = p * (1.0 - p)
    d = z.dual * dp
    return DualComplexTensor(_stack(p, d))


def dual_silu(z: DualComplexTensor) -> DualComplexTensor:
    # silu(z) = z * sigmoid(z); d/dz silu = sigmoid + z * sigmoid'(z)
    s = 1.0 / (1.0 + torch.exp(-z.primal))
    s_prime = s * (1.0 - s)
    p = z.primal * s
    dp = s + z.primal * s_prime
    d = z.dual * dp
    return DualComplexTensor(_stack(p, d))


class DualComplexLinear(nn.Module):
    """
    Dual-Complex linear layer:
      y_p = W_p x_p + b_p
      y_d = W_p x_d + W_d x_p + b_d

    Shapes follow PyTorch convention:
      - x: (..., in_features, 2) complex
      - W_*: (out_features, in_features) complex
      - b_*: (out_features,) complex
    """

    def __init__(
        self,
        in_features: int,
        out_features: int,
        bias: bool = True,
        *,
        enable_dual_weights: bool = True,
        dtype: torch.dtype = torch.complex64,
        device: Any = None,
    ) -> None:
        super().__init__()
        self.in_features = int(in_features)
        self.out_features = int(out_features)
        self.enable_dual_weights = bool(enable_dual_weights)

        self.weight_primal = nn.Parameter(
            torch.empty((self.out_features, self.in_features), dtype=dtype, device=device)
        )
        if self.enable_dual_weights:
            self.weight_dual = nn.Parameter(
                torch.empty((self.out_features, self.in_features), dtype=dtype, device=device)
            )
        else:
            self.weight_dual = None

        if bias:
            self.bias_primal = nn.Parameter(torch.empty((self.out_features,), dtype=dtype, device=device))
            if self.enable_dual_weights:
                self.bias_dual = nn.Parameter(torch.empty((self.out_features,), dtype=dtype, device=device))
            else:
                self.bias_dual = None
        else:
            self.bias_primal = None
            self.bias_dual = None

        self.reset_parameters()

    def reset_parameters(self) -> None:
        # Complex-safe init: uniform init real/imag parts of primal weights; dual weights start at 0.
        bound = 1.0 / (self.in_features**0.5)
        with torch.no_grad():
            self.weight_primal.real.uniform_(-bound, bound)
            self.weight_primal.imag.uniform_(-bound, bound)
            if self.weight_dual is not None:
                self.weight_dual.zero_()
            if self.bias_primal is not None:
                self.bias_primal.real.uniform_(-bound, bound)
                self.bias_primal.imag.uniform_(-bound, bound)
            if self.bias_dual is not None:
                self.bias_dual.zero_()

    def forward(self, x: Union[torch.Tensor, DualComplexTensor]) -> DualComplexTensor:
        data = x.data if isinstance(x, DualComplexTensor) else x
        if data.shape[-1] != 2:
            raise ValueError(f"Expected last dim=2 for (primal, dual); got shape={tuple(data.shape)}")
        xp = data[..., 0]
        xd = data[..., 1]

        yp = xp @ self.weight_primal.t()
        yd = xd @ self.weight_primal.t()
        if self.weight_dual is not None:
            yd = yd + (xp @ self.weight_dual.t())

        if self.bias_primal is not None:
            yp = yp + self.bias_primal
        if self.bias_dual is not None:
            yd = yd + self.bias_dual

        return DualComplexTensor(_stack(yp, yd))

