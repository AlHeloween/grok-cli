"""Stability gates for SE(3) Genesis consolidation (Stage 5).

Provides abort and promote gates based on Genesis metrics to ensure stability.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from aurora_genesis_core.pipeline.genesis_metrics import GenesisMetrics


@dataclass
class GenesisGateThresholds:
    """Thresholds for Genesis stability gates."""
    
    # Abort gate thresholds (if exceeded, abort Genesis step)
    max_total_cost: Optional[float] = None  # Maximum total cost
    max_mean_cost: Optional[float] = None  # Maximum mean cost
    max_medoid_shift: Optional[float] = None  # Maximum medoid shift
    max_invalid_dq_ratio: float = 0.1  # Maximum ratio of invalid DQs (default: 10%)
    min_cluster_size: int = 1  # Minimum cluster size (default: at least 1 point)
    
    # Promote gate thresholds (if met, promote medoids to memory banks)
    min_converged: bool = True  # Require convergence for promotion
    max_mean_cost_for_promotion: Optional[float] = None  # Maximum mean cost for promotion
    max_medoid_shift_for_promotion: Optional[float] = None  # Maximum shift for promotion
    
    def __post_init__(self):
        """Validate thresholds."""
        if self.max_invalid_dq_ratio < 0.0 or self.max_invalid_dq_ratio > 1.0:
            raise ValueError(f"max_invalid_dq_ratio must be in [0, 1], got {self.max_invalid_dq_ratio}")
        if self.min_cluster_size < 1:
            raise ValueError(f"min_cluster_size must be >= 1, got {self.min_cluster_size}")


@dataclass
class GenesisGateDecision:
    """Decision from Genesis stability gates."""
    
    abort: bool  # Whether to abort Genesis step
    promote: bool  # Whether to promote medoids to memory banks
    reason: str  # Reason for decision
    
    def to_dict(self) -> dict[str, any]:
        """Convert decision to dictionary for logging."""
        return {
            "abort": self.abort,
            "promote": self.promote,
            "reason": self.reason,
        }


def check_abort_gate(
    metrics: GenesisMetrics,
    thresholds: GenesisGateThresholds,
) -> Optional[str]:
    """
    Check if Genesis step should be aborted based on metrics.
    
    Args:
        metrics: Genesis metrics from clustering.
        thresholds: Gate thresholds.
    
    Returns:
        Abort reason string if should abort, None otherwise.
    """
    # Check total cost
    if thresholds.max_total_cost is not None and metrics.total_cost > thresholds.max_total_cost:
        return f"Total cost {metrics.total_cost:.2f} exceeds threshold {thresholds.max_total_cost:.2f}"
    
    # Check mean cost
    if thresholds.max_mean_cost is not None and metrics.mean_cost > thresholds.max_mean_cost:
        return f"Mean cost {metrics.mean_cost:.2f} exceeds threshold {thresholds.max_mean_cost:.2f}"
    
    # Check medoid shift
    if thresholds.max_medoid_shift is not None and metrics.medoid_shift_max > thresholds.max_medoid_shift:
        return f"Medoid shift {metrics.medoid_shift_max:.2f} exceeds threshold {thresholds.max_medoid_shift:.2f}"
    
    # Check invalid DQ ratio
    if metrics.invalid_dq_ratio > thresholds.max_invalid_dq_ratio:
        return f"Invalid DQ ratio {metrics.invalid_dq_ratio:.2%} exceeds threshold {thresholds.max_invalid_dq_ratio:.2%}"
    
    # Check minimum cluster size
    if metrics.cluster_size_min < thresholds.min_cluster_size:
        return f"Minimum cluster size {metrics.cluster_size_min} is less than threshold {thresholds.min_cluster_size}"
    
    return None  # No abort


def check_promote_gate(
    metrics: GenesisMetrics,
    thresholds: GenesisGateThresholds,
) -> bool:
    """
    Check if medoids should be promoted to memory banks based on metrics.
    
    Args:
        metrics: Genesis metrics from clustering.
        thresholds: Gate thresholds.
    
    Returns:
        True if should promote, False otherwise.
    """
    # Require convergence if specified
    if thresholds.min_converged and not metrics.converged:
        return False
    
    # Check mean cost for promotion
    if thresholds.max_mean_cost_for_promotion is not None:
        if metrics.mean_cost > thresholds.max_mean_cost_for_promotion:
            return False
    
    # Check medoid shift for promotion
    if thresholds.max_medoid_shift_for_promotion is not None:
        if metrics.medoid_shift_max > thresholds.max_medoid_shift_for_promotion:
            return False
    
    # All checks passed
    return True


def evaluate_genesis_gates(
    metrics: GenesisMetrics,
    thresholds: GenesisGateThresholds,
) -> GenesisGateDecision:
    """
    Evaluate Genesis stability gates and return decision.
    
    Args:
        metrics: Genesis metrics from clustering.
        thresholds: Gate thresholds.
    
    Returns:
        GenesisGateDecision with abort/promote flags and reason.
    """
    # Check abort gate first
    abort_reason = check_abort_gate(metrics, thresholds)
    if abort_reason is not None:
        return GenesisGateDecision(
            abort=True,
            promote=False,
            reason=f"Abort: {abort_reason}",
        )
    
    # Check promote gate
    should_promote = check_promote_gate(metrics, thresholds)
    if should_promote:
        return GenesisGateDecision(
            abort=False,
            promote=True,
            reason="Promote: All gate checks passed",
        )
    
    # Default: don't abort, but don't promote either (use medoids but don't update memory banks)
    return GenesisGateDecision(
        abort=False,
        promote=False,
        reason="No promotion: Metrics within acceptable range but promotion criteria not met",
    )
