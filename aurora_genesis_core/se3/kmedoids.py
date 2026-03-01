'''SE(3) K-Medoids + dual-quaternion geodesic distance. GPU-accelerated clustering on rigid-body manifold.'''

from __future__ import annotations

from typing import Optional, Tuple

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore


if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.se3.kmedoids requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )


def quat_conjugate(q: torch.Tensor) -> torch.Tensor:
    """Conjugate of quaternion: (w, x, y, z) -> (w, -x, -y, -z)."""
    q_conj = q.clone()
    q_conj[..., 1:] = -q_conj[..., 1:]
    return q_conj


def quat_multiply(q1: torch.Tensor, q2: torch.Tensor) -> torch.Tensor:
    """
    Multiply two quaternions: q1 * q2.

    Args:
        q1: Quaternion tensor (..., 4) with components [w, x, y, z].
        q2: Quaternion tensor (..., 4) with components [w, x, y, z].

    Returns:
        Product quaternion (..., 4).
    """
    w1, x1, y1, z1 = q1[..., 0], q1[..., 1], q1[..., 2], q1[..., 3]
    w2, x2, y2, z2 = q2[..., 0], q2[..., 1], q2[..., 2], q2[..., 3]

    w = w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2
    x = w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2
    y = w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2
    z = w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2

    return torch.stack([w, x, y, z], dim=-1)


def extract_translation_dual_quat(dq: torch.Tensor) -> torch.Tensor:
    """
    Extract translation vector from dual quaternion.

    Formula: t = 2 * (dual * conjugate(real)).vector_part

    Args:
        dq: Dual quaternion tensor (..., 8) with components [wr, xr, yr, zr, wd, xd, yd, zd].

    Returns:
        Translation vector tensor (..., 3).
    """
    # Split into real and dual quaternions
    real = dq[..., :4]  # (..., 4)
    dual = dq[..., 4:]  # (..., 4)

    # Normalize real part
    real_norm = torch.norm(real, dim=-1, keepdim=True)
    real_normalized = real / (real_norm + 1e-8)

    # Compute: dual * conjugate(real)
    real_conj = quat_conjugate(real_normalized)
    prod = quat_multiply(dual, real_conj)

    # Extract vector part (x, y, z) and multiply by 2
    translation = 2.0 * prod[..., 1:4]  # (..., 3)

    return translation


def dual_quat_geodesic_distance(
    dq1: torch.Tensor,
    dq2: torch.Tensor,
    w_rot: float = 1.0,
    w_trans: float = 1.0,
) -> torch.Tensor:
    """
    Compute geodesic distance between two dual quaternions on SE(3) manifold.

    Formula:
    - Rotation distance: geodesic on SO(3) = ||log(R1^T R2)|| = 2 * |arccos(<R1, R2>)|.
    - Translation distance: Euclidean ||t1 - t2||.
    - Combined: w_rot * rot_dist + w_trans * trans_dist.

    Args:
        dq1: Dual quaternion tensor (..., 8) with components [wr, xr, yr, zr, wd, xd, yd, zd].
        dq2: Dual quaternion tensor (..., 8) with components [wr, xr, yr, zr, wd, xd, yd, zd].
        w_rot: Weight for rotational distance component (default: 1.0).
        w_trans: Weight for translational distance component (default: 1.0).

    Returns:
        Geodesic distance tensor (...,) (scalar per pair).

    Raises:
        ValueError: If dq1 and dq2 shapes don't match or are not (..., 8).
    """
    if dq1.shape[-1] != 8:
        raise ValueError(f"Dual quaternions must have last dim=8, got {dq1.shape[-1]}")
    if dq2.shape[-1] != 8:
        raise ValueError(f"Dual quaternions must have last dim=8, got {dq2.shape[-1]}")
    if dq1.shape != dq2.shape:
        raise ValueError(f"dq1 and dq2 must have same shape, got {dq1.shape} and {dq2.shape}")

    # Normalize real parts (rotation quaternions)
    real1 = dq1[..., :4]  # (..., 4)
    real2 = dq2[..., :4]  # (..., 4)

    real1_norm = torch.norm(real1, dim=-1, keepdim=True)
    real2_norm = torch.norm(real2, dim=-1, keepdim=True)
    real1_normalized = real1 / (real1_norm + 1e-8)
    real2_normalized = real2 / (real2_norm + 1e-8)

    # Rotation distance: geodesic on SO(3)
    # Compute R1^T * R2 = conjugate(R1) * R2
    real1_conj = quat_conjugate(real1_normalized)
    rot_diff = quat_multiply(real1_conj, real2_normalized)

    # Angle = 2 * arccos(dot(R1, R2)) = 2 * arccos(rot_diff[0])
    # Clamp dot product to [-1, 1] for numerical stability
    dot_product = torch.clamp(rot_diff[..., 0], -1.0, 1.0)
    rot_angle = 2.0 * torch.arccos(torch.abs(dot_product))  # Use abs to handle double cover
    rot_dist = rot_angle

    # Translation distance: Euclidean
    trans1 = extract_translation_dual_quat(dq1)  # (..., 3)
    trans2 = extract_translation_dual_quat(dq2)  # (..., 3)
    trans_dist = torch.norm(trans1 - trans2, dim=-1)  # (...,)

    # Weighted combination
    distance = w_rot * rot_dist + w_trans * trans_dist

    return distance


class SE3KMedoids:
    """
    SE(3) K-Medoids clustering using Partitioning Around Medoids (PAM) algorithm.

    Clusters dual quaternions on SE(3) manifold using geodesic distance metric.
    GPU-accelerated distance computation, CPU-based PAM swap loop.

    Attributes:
        k: Number of clusters (medoids).
        max_iter: Maximum number of PAM swap iterations.
        tol: Tolerance for cost change (early termination).
        medoids: Learned medoids tensor (k, 8) or None if not fitted.
        labels: Cluster assignments (n_points,) or None if not fitted.
    """

    def __init__(self, n_clusters: int, max_iter: int = 100, tol: float = 1e-4):
        """
        Initialize SE3KMedoids.

        Args:
            n_clusters: Number of clusters (medoids).
            max_iter: Maximum number of PAM swap iterations.
            tol: Tolerance for cost change (early termination).
        """
        if n_clusters < 1:
            raise ValueError(f"n_clusters must be >= 1, got {n_clusters}")
        if max_iter < 1:
            raise ValueError(f"max_iter must be >= 1, got {max_iter}")
        if tol < 0:
            raise ValueError(f"tol must be >= 0, got {tol}")

        self.k = n_clusters
        self.max_iter = max_iter
        self.tol = tol
        self.medoids: Optional[torch.Tensor] = None
        self.labels: Optional[torch.Tensor] = None
        self.converged: bool = False  # Whether last fit() converged
        self.iterations: int = 0  # Number of iterations in last fit()

    def fit(self, dual_quats: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Fit SE3KMedoids to dual quaternions.

        PAM Algorithm:
        1. Initialize: Randomly select k medoids from input.
        2. Assignment: For each point, assign to nearest medoid.
        3. Swap Loop:
           - For each medoid m and non-medoid p:
             - Compute total cost change if swapping m ↔ p.
             - If cost decreases, perform swap.
           - Repeat until no swaps improve cost or max_iter reached.

        Args:
            dual_quats: Dual quaternion tensor (n_points, 8) on GPU.

        Returns:
            Tuple of (labels, medoids):
            - labels: Cluster assignments (n_points,) as int64 tensor.
            - medoids: Learned medoids (k, 8) on same device as input.

        Raises:
            ValueError: If dual_quats shape is not (n_points, 8) or n_points < k.
        """
        if dual_quats.dim() != 2 or dual_quats.shape[1] != 8:
            raise ValueError(f"dual_quats must be (n_points, 8), got {dual_quats.shape}")

        n_points = dual_quats.shape[0]
        if n_points < self.k:
            raise ValueError(f"n_points ({n_points}) must be >= k ({self.k})")

        device = dual_quats.device
        dtype = dual_quats.dtype

        # Step 1: Initialize medoids (random selection)
        medoid_indices = torch.randperm(n_points, device=device)[: self.k]
        medoids = dual_quats[medoid_indices].clone()  # (k, 8)

        # Normalize medoids (real parts must be unit quaternions)
        real_norms = torch.norm(medoids[:, :4], dim=1, keepdim=True)
        medoids[:, :4] = medoids[:, :4] / (real_norms + 1e-8)

        # Step 2: Initial assignment
        # Compute all pairwise distances: (n_points, k)
        distances = torch.zeros(n_points, self.k, device=device, dtype=dtype)
        for i in range(self.k):
            distances[:, i] = dual_quat_geodesic_distance(
                dual_quats, medoids[i : i + 1].expand(n_points, -1)
            )

        labels = torch.argmin(distances, dim=1)  # (n_points,)
        current_cost = distances[torch.arange(n_points, device=device), labels].sum().item()

        if self.k == 1:
            self.medoids = medoids
            self.labels = labels
            return labels, medoids

        # Step 3: PAM swap loop
        medoid_set = {int(i) for i in medoid_indices.tolist()}
        converged = False
        iterations = 0
        for iteration in range(self.max_iter):
            iterations = iteration + 1
            top2_vals, top2_idx = torch.topk(distances, k=2, largest=False, dim=1)
            best_vals = top2_vals[:, 0]
            best_idx = top2_idx[:, 0]
            second_vals = top2_vals[:, 1]
            second_idx = top2_idx[:, 1]

            best_cost_change = 0.0
            best_swap: Optional[tuple[int, int, torch.Tensor, torch.Tensor, float]] = None

            for m_idx in range(self.k):
                for p_idx in range(n_points):
                    if p_idx in medoid_set:
                        continue

                    cand = dual_quats[p_idx].clone()
                    real_norm = torch.norm(cand[:4], dim=0, keepdim=False)
                    cand[:4] = cand[:4] / (real_norm + 1e-8)

                    new_dist_m = dual_quat_geodesic_distance(
                        dual_quats, cand[None, :].expand(n_points, -1)
                    )

                    best_other = torch.where(best_idx == m_idx, second_vals, best_vals)
                    new_best = torch.minimum(new_dist_m, best_other)
                    new_cost = new_best.sum().item()

                    cost_change = current_cost - new_cost
                    if cost_change > best_cost_change:
                        best_cost_change = cost_change
                        best_swap = (m_idx, p_idx, cand, new_dist_m, new_cost)

            if best_swap is None or best_cost_change <= self.tol:
                converged = True
                break

            m_idx, p_idx, cand, new_dist_m, new_cost = best_swap
            old = int(medoid_indices[m_idx].item())
            medoid_set.remove(old)
            medoid_set.add(int(p_idx))

            medoid_indices[m_idx] = int(p_idx)
            medoids[m_idx] = cand
            distances[:, m_idx] = new_dist_m
            labels = torch.argmin(distances, dim=1)
            current_cost = float(new_cost)

        self.medoids = medoids
        self.labels = labels
        self.converged = converged
        self.iterations = iterations

        return labels, medoids
