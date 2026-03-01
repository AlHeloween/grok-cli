"""Ablation matrix for Aurora-Genesis acceptance suite (Stage 6).

Defines all ablation combinations to test:
- Baseline (no Aurora)
- Hooks only
- Memory only
- Full Aurora
- Memory promotion on/off
- Compute-reduction mode on/off
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from deepseek_adapter.config import AuroraConfig


@dataclass
class AblationConfig:
    """Configuration for a single ablation variant."""
    
    name: str  # Human-readable name (e.g., "baseline", "hooks_only", "full_aurora")
    description: str  # Description of this variant
    
    # Aurora component flags
    enable_wrapper_hooks: bool = False
    use_dual_complex: bool = False
    init_sierpinski: bool = False
    enable_se3_clustering: bool = False
    enable_adid_memory: bool = False
    
    # Memory promotion
    enable_memory_promotion: bool = False  # Teacher-verified promotion
    
    # Compute reduction
    enable_compute_reduction: bool = False  # Navigation paradigm / bounded KV
    
    # Genesis warm-up
    genesis_warmup_steps: int = 0
    
    def to_aurora_config(self, base_config: Optional[AuroraConfig] = None) -> AuroraConfig:
        """
        Convert to AuroraConfig.
        
        Args:
            base_config: Optional base config to inherit from.
        
        Returns:
            AuroraConfig with this ablation's settings.
        """
        if base_config is None:
            base_config = AuroraConfig()
        
        # Create new config with ablation settings
        config_dict = {
            "enable_wrapper_hooks": self.enable_wrapper_hooks,
            "use_dual_complex": self.use_dual_complex,
            "init_sierpinski": self.init_sierpinski,
            "enable_se3_clustering": self.enable_se3_clustering,
            "enable_adid_memory": self.enable_adid_memory,
            "genesis_warmup_steps": self.genesis_warmup_steps,
        }
        
        # Inherit other settings from base_config
        for field_name in base_config.__dataclass_fields__:
            if field_name not in config_dict:
                config_dict[field_name] = getattr(base_config, field_name)
        
        return AuroraConfig.from_dict(config_dict)
    
    def to_dict(self) -> dict[str, any]:
        """Convert to dictionary for serialization."""
        return {
            "name": self.name,
            "description": self.description,
            "enable_wrapper_hooks": self.enable_wrapper_hooks,
            "use_dual_complex": self.use_dual_complex,
            "init_sierpinski": self.init_sierpinski,
            "enable_se3_clustering": self.enable_se3_clustering,
            "enable_adid_memory": self.enable_adid_memory,
            "enable_memory_promotion": self.enable_memory_promotion,
            "enable_compute_reduction": self.enable_compute_reduction,
            "genesis_warmup_steps": self.genesis_warmup_steps,
        }


class AblationMatrix:
    """Matrix of ablation configurations to test."""
    
    def __init__(self):
        """Initialize ablation matrix with standard variants."""
        self.variants: list[AblationConfig] = []
        self._create_standard_variants()
    
    def _create_standard_variants(self) -> None:
        """Create standard ablation variants."""
        # 1. Baseline (no Aurora components)
        self.variants.append(AblationConfig(
            name="baseline",
            description="Baseline: No Aurora components, standard attention",
            enable_wrapper_hooks=False,
            use_dual_complex=False,
            init_sierpinski=False,
            enable_se3_clustering=False,
            enable_adid_memory=False,
            enable_memory_promotion=False,
            enable_compute_reduction=False,
        ))
        
        # 2. Hooks only (DCA + FMB, no memory promotion)
        self.variants.append(AblationConfig(
            name="hooks_only",
            description="Hooks only: Dual-complex adapter + fractal memory banks, no promotion",
            enable_wrapper_hooks=True,
            use_dual_complex=True,
            init_sierpinski=True,
            enable_se3_clustering=False,
            enable_adid_memory=False,
            enable_memory_promotion=False,
            enable_compute_reduction=False,
        ))
        
        # 3. Memory only (memory banks, no hooks)
        self.variants.append(AblationConfig(
            name="memory_only",
            description="Memory only: Memory banks with promotion, no hooks",
            enable_wrapper_hooks=False,
            use_dual_complex=False,
            init_sierpinski=True,
            enable_se3_clustering=False,
            enable_adid_memory=True,
            enable_memory_promotion=True,
            enable_compute_reduction=False,
        ))
        
        # 4. Full Aurora (hooks + memory + compute reduction)
        self.variants.append(AblationConfig(
            name="full_aurora",
            description="Full Aurora: Hooks + memory + compute reduction (Navigation paradigm)",
            enable_wrapper_hooks=True,
            use_dual_complex=True,
            init_sierpinski=True,
            enable_se3_clustering=True,
            enable_adid_memory=True,
            enable_memory_promotion=True,
            enable_compute_reduction=True,
            genesis_warmup_steps=100,
        ))
        
        # 5. Full Aurora without compute reduction
        self.variants.append(AblationConfig(
            name="full_aurora_no_compute_reduction",
            description="Full Aurora without compute reduction: Hooks + memory, unbounded KV",
            enable_wrapper_hooks=True,
            use_dual_complex=True,
            init_sierpinski=True,
            enable_se3_clustering=True,
            enable_adid_memory=True,
            enable_memory_promotion=True,
            enable_compute_reduction=False,
            genesis_warmup_steps=100,
        ))
        
        # 6. Full Aurora without memory promotion
        self.variants.append(AblationConfig(
            name="full_aurora_no_promotion",
            description="Full Aurora without memory promotion: Hooks + memory, no teacher gating",
            enable_wrapper_hooks=True,
            use_dual_complex=True,
            init_sierpinski=True,
            enable_se3_clustering=True,
            enable_adid_memory=True,
            enable_memory_promotion=False,
            enable_compute_reduction=True,
            genesis_warmup_steps=100,
        ))
    
    def add_variant(self, variant: AblationConfig) -> None:
        """Add a custom variant to the matrix."""
        self.variants.append(variant)
    
    def get_variant(self, name: str) -> Optional[AblationConfig]:
        """Get variant by name."""
        for variant in self.variants:
            if variant.name == name:
                return variant
        return None
    
    def to_dict(self) -> dict[str, any]:
        """Convert to dictionary for serialization."""
        return {
            "variants": [v.to_dict() for v in self.variants],
        }


def create_ablation_matrix() -> AblationMatrix:
    """Create standard ablation matrix."""
    return AblationMatrix()
