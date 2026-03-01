"""Acceptance suite for Aurora-Genesis Endless Memory validation.

Stage 6: Integration + Ablation Reporting + Endless-Memory Acceptance Suite
"""

from aurora_genesis_core.applications.acceptance.ablation_matrix import (
    AblationConfig,
    AblationMatrix,
    create_ablation_matrix,
)
from aurora_genesis_core.applications.acceptance.reporting import (
    AcceptanceReport,
    generate_executive_summary,
    save_acceptance_report,
)

__all__ = [
    "AblationConfig",
    "AblationMatrix",
    "create_ablation_matrix",
    "AcceptanceReport",
    "generate_executive_summary",
    "save_acceptance_report",
]
