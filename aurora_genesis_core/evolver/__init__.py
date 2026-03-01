"""Evolver: Temporal dynamics via screw theory."""

from aurora_genesis_core.evolver.screw_theory import (
    ScrewParameters,
    compute_screw_motion,
    screw_to_dual_quaternion,
    dual_quaternion_to_screw,
)
from aurora_genesis_core.evolver.temporal_evolution import TemporalEvolver
from aurora_genesis_core.evolver.temporal_loss import TemporalLoss

__all__ = [
    "ScrewParameters",
    "compute_screw_motion",
    "screw_to_dual_quaternion",
    "dual_quaternion_to_screw",
    "TemporalEvolver",
    "TemporalLoss",
]
