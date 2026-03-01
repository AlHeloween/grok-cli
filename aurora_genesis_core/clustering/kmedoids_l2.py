"""K-medoids (PAM) for Euclidean (L2) spaces."""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from typing import Optional

if importlib.util.find_spec("torch") is None:
    raise ImportError(
        "aurora_genesis_core.clustering.kmedoids_l2 requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )

import torch


@dataclass(frozen=True)
class KMedoidsResult:
    medoid_indices: torch.Tensor  # (k,)
    assignment: torch.Tensor  # (N,) values in [0, k)
    cost: torch.Tensor  # scalar


def _pairwise_l2_sq(x: torch.Tensor) -> torch.Tensor:
    x = x.to(dtype=torch.float32)
    x2 = (x * x).sum(dim=-1, keepdim=True)  # (N, 1)
    dist2 = x2 + x2.t() - 2.0 * (x @ x.t())
    return dist2


def kmedoids_pam_l2(
    x: torch.Tensor,
    *,
    k: int,
    max_iter: int = 10,
    tol: float = 1e-4,
    seed: int = 1234,
    initial_medoids: Optional[torch.Tensor] = None,
) -> KMedoidsResult:
    """
    Run PAM K-medoids on Euclidean points using squared L2 distance.

    Notes:
    - Deterministic initialization via `seed` when `initial_medoids` is None.
    - Uses a precomputed NxN distance matrix; intended for moderate N.
    """
    if x.ndim != 2:
        raise ValueError(f"Expected x shape (N, D), got {tuple(x.shape)}")
    n = int(x.shape[0])
    if n < 1:
        raise ValueError("x must have at least 1 row")
    if k < 1 or k > n:
        raise ValueError(f"k must be in [1, N], got k={k}, N={n}")
    if max_iter < 0:
        raise ValueError(f"max_iter must be >= 0, got {max_iter}")
    if tol < 0:
        raise ValueError(f"tol must be >= 0, got {tol}")

    dist = _pairwise_l2_sq(x)  # (N, N), float32

    device = dist.device
    if initial_medoids is None:
        g = torch.Generator(device=device)
        g.manual_seed(int(seed))
        medoids = torch.randperm(n, generator=g, device=device)[:k].clone()
    else:
        medoids = initial_medoids.to(device=device, dtype=torch.long).clone()
        if medoids.ndim != 1 or int(medoids.shape[0]) != k:
            raise ValueError(f"initial_medoids must have shape (k,), got {tuple(medoids.shape)}")
        if int(torch.unique(medoids).numel()) != k:
            raise ValueError("initial_medoids must be unique")
        if torch.any((medoids < 0) | (medoids >= n)):
            raise ValueError("initial_medoids out of range")

    def _compute_assign_cost(m: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        d = dist[:, m]  # (N, k)
        min_dist, argmin = d.min(dim=1)
        return argmin, min_dist.sum()

    assignment, cost = _compute_assign_cost(medoids)

    for _ in range(int(max_iter)):
        improved_any = False

        for mi in range(k):
            # Precompute best distance to medoids excluding column mi.
            d = dist[:, medoids]  # (N, k)
            if k == 1:
                best_without = torch.full((n,), float("inf"), device=device, dtype=torch.float32)
            else:
                vals, idxs = torch.topk(d, k=2, dim=1, largest=False)
                first = vals[:, 0]
                first_arg = idxs[:, 0]
                second = vals[:, 1]
                best_without = torch.where(first_arg == mi, second, first)

            is_medoid = torch.zeros((n,), device=device, dtype=torch.bool)
            is_medoid[medoids] = True
            candidates = (~is_medoid).nonzero(as_tuple=False).flatten()

            best_cost = cost
            best_j = int(medoids[mi].item())

            for j_t in candidates:
                j = int(j_t.item())
                new_min = torch.minimum(best_without, dist[:, j])
                new_cost = new_min.sum()
                if new_cost + float(tol) < best_cost:
                    best_cost = new_cost
                    best_j = j

            if best_j != int(medoids[mi].item()):
                medoids[mi] = best_j
                assignment, cost = _compute_assign_cost(medoids)
                improved_any = True

        if not improved_any:
            break

    # Final assignment is in [0, k) by construction.
    return KMedoidsResult(medoid_indices=medoids, assignment=assignment, cost=cost)
