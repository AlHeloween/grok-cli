'''Pipeline integration: end-to-end Aurora-Genesis training/inference runtime.'''

from __future__ import annotations

import importlib.util

if importlib.util.find_spec("torch") is None:
    __all__ = []
else:
    from aurora_genesis_core.pipeline.dual_complex_encoder import DualComplexEncoder
    from aurora_genesis_core.pipeline.genesis_step import GenesisStep
    from aurora_genesis_core.pipeline.loss_assembly import LossAssembly
    from aurora_genesis_core.pipeline.memory_addressing import MemoryAddressing
    from aurora_genesis_core.pipeline.stability import (
        check_finite_tensor,
        check_valid_dual_quaternion,
        check_valid_medoids,
        clamp_quaternion_dot,
        normalize_dual_quaternion,
    )
    from aurora_genesis_core.pipeline.trainer import AuroraGenesisTrainer

    __all__ = [
        "AuroraGenesisTrainer",
        "DualComplexEncoder",
        "MemoryAddressing",
        "GenesisStep",
        "LossAssembly",
        "clamp_quaternion_dot",
        "normalize_dual_quaternion",
        "check_finite_tensor",
        "check_valid_dual_quaternion",
        "check_valid_medoids",
    ]
