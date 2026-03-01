"""Integration of Transcender with memory pipeline."""

from __future__ import annotations

from typing import Optional

from aurora_genesis_core.memory.lattice_memory_bank import LatticeMemoryBank
from aurora_genesis_core.transcender.promotion_system import PromotionSystem, PromotionPolicy
from aurora_genesis_core.transcender.rewrite_rules import RewriteRule
from aurora_genesis_core.transcender.compression_metrics import CompressionMetrics


def integrate_transcender(
    memory_bank: LatticeMemoryBank,
    rewrite_rules: Optional[list[RewriteRule]] = None,
    promotion_policy: Optional[PromotionPolicy] = None,
    compression_metrics: Optional[CompressionMetrics] = None,
) -> PromotionSystem:
    """Integrate Transcender with memory bank.
    
    Args:
        memory_bank: Memory bank to integrate with
        rewrite_rules: Optional rewrite rules (uses default if None)
        promotion_policy: Optional promotion policy (uses default if None)
        compression_metrics: Optional compression metrics (uses default if None)
    
    Returns:
        PromotionSystem instance
    """
    # Create default components if not provided
    if rewrite_rules is None:
        rewrite_rules = [
            RewriteRule(
                trigger_type="count",
                threshold=3.0,
                selection_method="similarity",
                synthesis_method="mean",
            ),
        ]
    
    if compression_metrics is None:
        compression_metrics = CompressionMetrics(
            max_information_loss=0.1,
            min_compression_ratio=0.5,
        )
    
    # Create promotion system
    promotion_system = PromotionSystem(
        rewrite_rules=rewrite_rules,
        compression_metrics=compression_metrics,
        promotion_policy=promotion_policy,
    )
    
    return promotion_system


def auto_promote_on_write(
    memory_bank: LatticeMemoryBank,
    promotion_system: PromotionSystem,
    level: int = 0,
) -> None:
    """Automatically promote entries after write (if conditions met).
    
    Args:
        memory_bank: Memory bank
        promotion_system: Promotion system
        level: Level to check for promotion
    """
    promotion_system.increment_write_count()
    
    if promotion_system.should_promote_now():
        promotion_system.check_and_promote(memory_bank, level)


def run_hierarchical_compression(
    memory_bank: LatticeMemoryBank,
    promotion_system: PromotionSystem,
) -> dict[int, int]:
    """Run hierarchical compression on entire memory bank.
    
    Args:
        memory_bank: Memory bank to compress
        promotion_system: Promotion system
    
    Returns:
        Dictionary mapping level -> number of promotions
    """
    return memory_bank.update_hierarchy(promotion_system)
