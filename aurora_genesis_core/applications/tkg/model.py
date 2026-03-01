from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import torch
from torch import nn

from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor, _stack


def _complex_init(shape, *, device: Optional[str], dtype: torch.dtype = torch.complex64) -> torch.Tensor:
    if dtype not in (torch.complex64, torch.complex128):
        raise ValueError(f"complex dtype required, got {dtype}")
    t = torch.empty(shape, device=device, dtype=dtype)
    nn.init.normal_(t.real, mean=0.0, std=0.02)
    nn.init.normal_(t.imag, mean=0.0, std=0.02)
    return t


class ComplexStaticTKGModel(nn.Module):
    """Static ComplEx-style scoring: score(s,r,o) = Re(sum(e_s * e_r * conj(e_o)))."""

    def __init__(self, *, n_entities: int, n_relations: int, dim: int, device: Optional[str] = None) -> None:
        super().__init__()
        self.n_entities = int(n_entities)
        self.n_relations = int(n_relations)
        self.dim = int(dim)
        self.ent = nn.Parameter(_complex_init((self.n_entities, self.dim), device=device))
        self.rel = nn.Parameter(_complex_init((self.n_relations, self.dim), device=device))

    def score_triples(self, *, s: torch.Tensor, r: torch.Tensor, o: torch.Tensor, tau: torch.Tensor) -> torch.Tensor:
        _ = tau  # kept for interface compatibility
        es = self.ent[s]
        er = self.rel[r]
        eo = self.ent[o]
        return torch.real(torch.sum(es * er * torch.conj(eo), dim=-1))

    def score_all_tails(self, *, s: torch.Tensor, r: torch.Tensor, t: torch.Tensor, tau: torch.Tensor, n_entities: int) -> torch.Tensor:
        _ = t, tau
        if int(n_entities) != self.n_entities:
            raise ValueError(f"n_entities mismatch: got {n_entities}, model has {self.n_entities}")
        es = self.ent[s]  # (B, D)
        er = self.rel[r]  # (B, D)
        x = es * er  # (B, D)
        all_o = self.ent  # (E, D)
        scores = torch.real(x @ torch.conj(all_o).transpose(0, 1))  # (B, E)
        return scores


class DualComplexLinearTimeTKGModel(nn.Module):
    """Dual-complex, time-conditioned scoring via e(τ)=primal + τ * dual, then ComplEx-style score."""

    def __init__(self, *, n_entities: int, n_relations: int, dim: int, device: Optional[str] = None) -> None:
        super().__init__()
        self.n_entities = int(n_entities)
        self.n_relations = int(n_relations)
        self.dim = int(dim)

        ent_p = _complex_init((self.n_entities, self.dim), device=device)
        ent_d = _complex_init((self.n_entities, self.dim), device=device) * 0.0
        rel_p = _complex_init((self.n_relations, self.dim), device=device)
        rel_d = _complex_init((self.n_relations, self.dim), device=device) * 0.0
        self.ent = nn.Parameter(_stack(ent_p, ent_d))
        self.rel = nn.Parameter(_stack(rel_p, rel_d))

    def _at_time(self, emb: DualComplexTensor, tau: torch.Tensor) -> torch.Tensor:
        # tau: (B,) float32
        if tau.dim() != 1:
            raise ValueError(f"tau must be (B,), got shape={tuple(tau.shape)}")
        return emb.primal + tau[:, None].to(dtype=emb.primal.real.dtype) * emb.dual

    def score_triples(self, *, s: torch.Tensor, r: torch.Tensor, o: torch.Tensor, tau: torch.Tensor) -> torch.Tensor:
        es = DualComplexTensor(self.ent[s])
        er = DualComplexTensor(self.rel[r])
        eo = DualComplexTensor(self.ent[o])
        es_t = self._at_time(es, tau)
        er_t = self._at_time(er, tau)
        eo_t = self._at_time(eo, tau)
        return torch.real(torch.sum(es_t * er_t * torch.conj(eo_t), dim=-1))

    def score_all_tails(self, *, s: torch.Tensor, r: torch.Tensor, t: torch.Tensor, tau: torch.Tensor, n_entities: int) -> torch.Tensor:
        _ = t
        if int(n_entities) != self.n_entities:
            raise ValueError(f"n_entities mismatch: got {n_entities}, model has {self.n_entities}")
        es = DualComplexTensor(self.ent[s])
        er = DualComplexTensor(self.rel[r])
        es_t = self._at_time(es, tau)  # (B, D)
        er_t = self._at_time(er, tau)  # (B, D)
        x = es_t * er_t  # (B, D)
        ent_all = DualComplexTensor(self.ent)
        op = ent_all.primal  # (E, D)
        od = ent_all.dual  # (E, D)

        # score_e = Re(sum_d x_d * conj(op_e,d + tau * od_e,d))
        #        = Re( x @ conj(op).T + tau * x @ conj(od).T )
        base = x @ torch.conj(op).transpose(0, 1)  # (B, E)
        vel = x @ torch.conj(od).transpose(0, 1)  # (B, E)
        scores = torch.real(base + tau[:, None].to(dtype=vel.real.dtype) * vel)
        return scores
