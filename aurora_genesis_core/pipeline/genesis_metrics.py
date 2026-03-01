"""Genesis acceptance metrics for SE(3) consolidation.

Provides metrics to evaluate Genesis step quality and stability:
- Finite cost (total clustering cost)
- Medoid shift magnitude (distance moved by medoids)
- Cluster sizes (distribution of cluster assignments)
- Invalid dual quaternion counts (NaN/Inf detection)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore

if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.pipeline.genesis_metrics requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )


@dataclass
class GenesisMetrics:
    """Metrics for evaluating Genesis step quality and stability."""
    
    # Cost metrics
    total_cost: float  # Total clustering cost (sum of distances to medoids)
    mean_cost: float  # Mean cost per point
    max_cost: float  # Maximum cost (worst point-to-medoid distance)
    
    # Medoid shift metrics
    medoid_shift_mean: float  # Mean shift magnitude across all medoids
    medoid_shift_max: float  # Maximum shift magnitude
    medoid_shift_std: float  # Standard deviation of shift magnitudes
    
    # Cluster size metrics
    cluster_sizes: list[int]  # Size of each cluster
    cluster_size_mean: float  # Mean cluster size
    cluster_size_std: float  # Standard deviation of cluster sizes
    cluster_size_min: int  # Minimum cluster size
    cluster_size_max: int  # Maximum cluster size
    
    # Invalid dual quaternion metrics
    invalid_dq_count: int  # Number of invalid DQs (NaN/Inf)
    invalid_dq_ratio: float  # Ratio of invalid DQs to total
    
    # Convergence metrics
    converged: bool  # Whether clustering converged
    iterations: int  # Number of iterations until convergence
    
    def to_dict(self) -> dict[str, any]:
        """Convert metrics to dictionary for logging/artifacts."""
        return {
            "total_cost": self.total_cost,
            "mean_cost": self.mean_cost,
            "max_cost": self.max_cost,
            "medoid_shift_mean": self.medoid_shift_mean,
            "medoid_shift_max": self.medoid_shift_max,
            "medoid_shift_std": self.medoid_shift_std,
            "cluster_sizes": self.cluster_sizes,
            "cluster_size_mean": self.cluster_size_mean,
            "cluster_size_std": self.cluster_size_std,
            "cluster_size_min": self.cluster_size_min,
            "cluster_size_max": self.cluster_size_max,
            "invalid_dq_count": self.invalid_dq_count,
            "invalid_dq_ratio": self.invalid_dq_ratio,
            "converged": self.converged,
            "iterations": self.iterations,
        }


def compute_genesis_metrics(
    buffer_embeddings: torch.Tensor,  # (N, 8) - input dual quaternions
    medoids: torch.Tensor,  # (K, 8) - output medoids
    labels: torch.Tensor,  # (N,) - cluster assignments
    previous_medoids: Optional[torch.Tensor] = None,  # (K, 8) - previous medoids for shift calculation
    w_rot: float = 1.0,
    w_trans: float = 1.0,
    converged: bool = True,
    iterations: int = 0,
) -> GenesisMetrics:
    """
    Compute Genesis acceptance metrics from clustering results.
    
    Args:
        buffer_embeddings: Input dual quaternion embeddings (N, 8).
        medoids: Output medoids from clustering (K, 8).
        labels: Cluster assignments for each embedding (N,).
        previous_medoids: Previous medoids for shift calculation (K, 8). If None, shift is 0.
        w_rot: Weight for rotational distance component.
        w_trans: Weight for translational distance component.
        converged: Whether clustering converged.
        iterations: Number of iterations until convergence.
    
    Returns:
        GenesisMetrics object with all computed metrics.
    """
    from aurora_genesis_core.se3.kmedoids import dual_quat_geodesic_distance
    
    device = buffer_embeddings.device
    N = buffer_embeddings.shape[0]
    K = medoids.shape[0]
    
    # 1. Compute cost metrics (distances from points to their assigned medoids)
    costs = torch.zeros(N, device=device, dtype=buffer_embeddings.dtype)
    for i in range(N):
        point = buffer_embeddings[i:i+1]  # (1, 8)
        medoid_idx = int(labels[i].item())
        medoid = medoids[medoid_idx:medoid_idx+1]  # (1, 8)
        cost = dual_quat_geodesic_distance(point, medoid, w_rot=w_rot, w_trans=w_trans)
        costs[i] = cost
    
    total_cost = float(costs.sum().item())
    mean_cost = float(costs.mean().item())
    max_cost = float(costs.max().item())
    
    # 2. Compute medoid shift metrics (if previous medoids provided)
    if previous_medoids is not None and previous_medoids.shape == medoids.shape:
        shifts = torch.zeros(K, device=device, dtype=buffer_embeddings.dtype)
        for k in range(K):
            shift = dual_quat_geodesic_distance(
                medoids[k:k+1],  # (1, 8)
                previous_medoids[k:k+1],  # (1, 8)
                w_rot=w_rot,
                w_trans=w_trans,
            )
            shifts[k] = shift
        
        medoid_shift_mean = float(shifts.mean().item())
        medoid_shift_max = float(shifts.max().item())
        medoid_shift_std = float(shifts.std().item())
    else:
        medoid_shift_mean = 0.0
        medoid_shift_max = 0.0
        medoid_shift_std = 0.0
    
    # 3. Compute cluster size metrics
    cluster_sizes = [0] * K
    for label in labels:
        cluster_sizes[int(label.item())] += 1
    
    cluster_sizes_tensor = torch.tensor(cluster_sizes, device=device, dtype=torch.float32)
    cluster_size_mean = float(cluster_sizes_tensor.mean().item())
    cluster_size_std = float(cluster_sizes_tensor.std().item())
    cluster_size_min = int(cluster_sizes_tensor.min().item())
    cluster_size_max = int(cluster_sizes_tensor.max().item())
    
    # 4. Compute invalid dual quaternion counts
    # Check for NaN or Inf in buffer embeddings
    invalid_mask = torch.isnan(buffer_embeddings).any(dim=-1) | torch.isinf(buffer_embeddings).any(dim=-1)
    invalid_dq_count = int(invalid_mask.sum().item())
    invalid_dq_ratio = float(invalid_dq_count / N) if N > 0 else 0.0
    
    return GenesisMetrics(
        total_cost=total_cost,
        mean_cost=mean_cost,
        max_cost=max_cost,
        medoid_shift_mean=medoid_shift_mean,
        medoid_shift_max=medoid_shift_max,
        medoid_shift_std=medoid_shift_std,
        cluster_sizes=cluster_sizes,
        cluster_size_mean=cluster_size_mean,
        cluster_size_std=cluster_size_std,
        cluster_size_min=cluster_size_min,
        cluster_size_max=cluster_size_max,
        invalid_dq_count=invalid_dq_count,
        invalid_dq_ratio=invalid_dq_ratio,
        converged=converged,
        iterations=iterations,
    )
