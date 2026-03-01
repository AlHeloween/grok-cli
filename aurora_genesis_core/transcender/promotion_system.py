"""Automatic promotion system for hierarchical compression."""

from __future__ import annotations

from typing import Optional
from dataclasses import dataclass

from aurora_genesis_core.memory.lattice_storage import MemoryEntry
from aurora_genesis_core.memory.lattice_memory_bank import LatticeMemoryBank
from aurora_genesis_core.transcender.rewrite_rules import RewriteRule
from aurora_genesis_core.transcender.compression_metrics import CompressionMetrics


@dataclass
class PromotionPolicy:
    """Policy for when and how to promote entries."""
    
    max_entries_per_level: int = 512
    min_compression_ratio: float = 0.5
    max_information_loss: float = 0.1
    promotion_interval: int = 1000  # Promote every N writes
    enable_automatic: bool = True


class PromotionSystem:
    """Automatic promotion system for hierarchical compression.
    
    Monitors memory banks and applies rewrite rules when
    promotion conditions are met.
    """
    
    def __init__(
        self,
        rewrite_rules: list[RewriteRule],
        compression_metrics: CompressionMetrics,
        promotion_policy: Optional[PromotionPolicy] = None,
    ):
        """Initialize promotion system.
        
        Args:
            rewrite_rules: List of rewrite rules to apply
            compression_metrics: Metrics for quality checking
            promotion_policy: Promotion policy (uses default if None)
        """
        self.rewrite_rules = rewrite_rules
        self.compression_metrics = compression_metrics
        self.policy = promotion_policy or PromotionPolicy()
        
        # Track write count for interval-based promotion
        self.write_count = 0
    
    def check_and_promote(
        self,
        memory_bank: LatticeMemoryBank,
        level: int,
    ) -> list[MemoryEntry]:
        """Check promotion conditions and apply promotions.
        
        Args:
            memory_bank: Memory bank to check
            level: Level to check
        
        Returns:
            List of promoted entries
        """
        if not self.policy.enable_automatic:
            return []
        
        # Get entries at level
        level_entries = memory_bank.storage.level_entries(level)
        all_entries = []
        for _, entries in level_entries:
            all_entries.extend(entries)
        
        if not all_entries:
            return []
        
        # Check each rewrite rule
        promoted_entries = []
        
        for rule in self.rewrite_rules:
            if not rule.should_promote(level, all_entries):
                continue
            
            # Select triplets
            triplets = rule.select_triplets(all_entries)
            
            # Apply rewrites
            for triplet in triplets:
                target_level = level + 1
                if target_level >= memory_bank.n_levels:
                    continue  # Can't promote beyond max level
                
                synthesized = rule.apply_rewrite(triplet, target_level)
                
                # Check quality bounds
                original_count = 3  # Triplet
                synthesized_count = 1
                meets_bounds, metrics = self.compression_metrics.check_quality_bounds(
                    list(triplet),
                    synthesized,
                    original_count,
                    synthesized_count,
                )
                
                if meets_bounds:
                    promoted_entries.append(synthesized)
        
        return promoted_entries
    
    def promote_level(
        self,
        memory_bank: LatticeMemoryBank,
        from_level: int,
        to_level: int,
    ) -> int:
        """Promote entries from one level to next.
        
        Args:
            memory_bank: Memory bank
            from_level: Source level
            to_level: Target level
        
        Returns:
            Number of entries promoted
        """
        if to_level >= memory_bank.n_levels:
            return 0
        
        # Get entries at source level
        level_entries = memory_bank.storage.level_entries(from_level)
        all_entries = []
        for _, entries in level_entries:
            all_entries.extend(entries)
        
        if not all_entries:
            return 0
        
        promoted_count = 0
        
        # Apply rewrite rules
        for rule in self.rewrite_rules:
            triplets = rule.select_triplets(all_entries)
            
            for triplet in triplets:
                synthesized = rule.apply_rewrite(triplet, to_level)
                
                # Check quality
                meets_bounds, _ = self.compression_metrics.check_quality_bounds(
                    list(triplet),
                    synthesized,
                    3,
                    1,
                )
                
                if meets_bounds:
                    # Add to target level
                    from aurora_genesis_core.memory.lattice_addressing import SierpinskiLatticeAddress
                    
                    # Find appropriate address at target level
                    # Simplified: use first available address
                    target_address = SierpinskiLatticeAddress(
                        level=to_level,
                        index=promoted_count % memory_bank.n_per_level,
                        sub_index=0,
                    )
                    
                    memory_bank.storage.write_leaf(target_address, synthesized)
                    promoted_count += 1
        
        return promoted_count
    
    def update_hierarchy(
        self,
        memory_bank: LatticeMemoryBank,
    ) -> dict[int, int]:
        """Update entire hierarchy using promotion system.
        
        Args:
            memory_bank: Memory bank to update
        
        Returns:
            Dictionary mapping level -> number of promotions
        """
        promotions = {}
        
        # Promote from bottom to top
        for level in range(memory_bank.n_levels - 1):
            promoted = self.promote_level(memory_bank, level, level + 1)
            promotions[level] = promoted
        
        return promotions
    
    def should_promote_now(self) -> bool:
        """Check if promotion should occur based on interval.
        
        Returns:
            True if promotion interval reached
        """
        if self.write_count >= self.policy.promotion_interval:
            self.write_count = 0
            return True
        return False
    
    def increment_write_count(self) -> None:
        """Increment write count (call after each write)."""
        self.write_count += 1
