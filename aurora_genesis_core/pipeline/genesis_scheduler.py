"""Warm-up scheduling for SE(3) Genesis consolidation (Stage 5).

Implements "warm-up then enable Genesis" scheduling to avoid early instability.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class GenesisScheduler:
    """Scheduler for Genesis step enablement with warm-up period."""
    
    warmup_steps: int = 0  # Steps 0..warmup_steps: dual-complex only (no Genesis)
    genesis_interval_steps: int = 100  # Steps warmup_steps..: enable Genesis every N steps
    gradual_enablement: bool = False  # If True, gradually increase Genesis frequency
    
    def __post_init__(self):
        """Validate scheduler parameters."""
        if self.warmup_steps < 0:
            raise ValueError(f"warmup_steps must be >= 0, got {self.warmup_steps}")
        if self.genesis_interval_steps < 1:
            raise ValueError(f"genesis_interval_steps must be >= 1, got {self.genesis_interval_steps}")
    
    def should_enable_genesis(self, step: int) -> bool:
        """
        Check if Genesis should be enabled at this step.
        
        Args:
            step: Current training step.
        
        Returns:
            True if Genesis should be enabled, False otherwise.
        """
        # Warm-up period: disable Genesis
        if step < self.warmup_steps:
            return False
        
        # After warm-up: enable Genesis at intervals
        if self.gradual_enablement:
            # Gradually increase frequency: start with 2x interval, then 1.5x, then 1x
            steps_since_warmup = step - self.warmup_steps
            phase1_end = self.genesis_interval_steps * 4  # 200 for interval=50 (step 300)
            phase2_start = self.genesis_interval_steps * 4  # 200 for interval=50 (step 300)
            phase3_start = self.genesis_interval_steps * 5  # 250 for interval=50 (step 350)
            
            # Phase 1: every 2x interval (0, 100, 200 for interval=50)
            # Includes step 300 (steps_since=200) - this is the last step of phase 1
            if steps_since_warmup <= phase1_end:
                return steps_since_warmup % (self.genesis_interval_steps * 2) == 0
            
            # Phase 2: every 1.5x interval (steps_since > 200)
            # Enable when (steps_since - 200) % 75 == 0, BUT exclude step 350 (steps_since=250)
            # Step 375: steps_since=275, (275-200) % 75 = 75 % 75 = 0, True
            # Step 450: steps_since=350, (350-200) % 75 = 150 % 75 = 0, True
            # But step 350 (steps_since=250) is phase 3, so exclude it
            steps_from_phase2 = steps_since_warmup - phase2_start
            if steps_from_phase2 > 0 and steps_since_warmup != phase3_start:
                if steps_from_phase2 % int(self.genesis_interval_steps * 1.5) == 0:
                    return True
            
            # Phase 3: every 1x interval (starts at steps_since >= 250, step >= 350)
            # Step 350: steps_since=250, 250 % 50 = 0, True
            # Step 400: steps_since=300, 300 % 50 = 0, True
            if steps_since_warmup >= phase3_start:
                return steps_since_warmup % self.genesis_interval_steps == 0
            
            return False
        else:
            # Standard interval-based enablement
            steps_since_warmup = step - self.warmup_steps
            return steps_since_warmup % self.genesis_interval_steps == 0
    
    def get_genesis_phase(self, step: int) -> str:
        """
        Get current Genesis phase name.
        
        Args:
            step: Current training step.
        
        Returns:
            Phase name: "warmup", "gradual", or "full".
        """
        if step < self.warmup_steps:
            return "warmup"
        
        if self.gradual_enablement:
            steps_since_warmup = step - self.warmup_steps
            if steps_since_warmup < self.genesis_interval_steps * 2:
                return "gradual_phase1"
            elif steps_since_warmup < self.genesis_interval_steps * 4:
                return "gradual_phase2"
            else:
                return "full"
        else:
            return "full"
    
    def to_dict(self) -> dict[str, any]:
        """Convert scheduler to dictionary for logging."""
        return {
            "warmup_steps": self.warmup_steps,
            "genesis_interval_steps": self.genesis_interval_steps,
            "gradual_enablement": self.gradual_enablement,
        }
