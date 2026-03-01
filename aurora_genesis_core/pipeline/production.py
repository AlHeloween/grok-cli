"""Production-ready Aurora pipeline with error handling."""

from __future__ import annotations

import logging
from typing import Optional, Any
import torch
import torch.nn as nn

from aurora_genesis_core.pipeline.full_integration import FullAuroraPipeline

# Setup logging
logger = logging.getLogger(__name__)


class ProductionAuroraPipeline(FullAuroraPipeline):
    """Production-ready Aurora pipeline with error handling."""
    
    def __init__(
        self,
        probe_encoder: nn.Module,
        ffe_quantizer: Any,
        memory_bank: Any,
        transcender: Any,
        evolver: Optional[Any] = None,
        use_dual_complex: bool = True,
        device: Optional[str] = None,
        fallback_model: Optional[nn.Module] = None,
    ):
        """Initialize production pipeline.
        
        Args:
            probe_encoder: Probe encoder instance
            ffe_quantizer: FFE quantizer instance
            memory_bank: Memory bank instance
            transcender: Promotion system instance
            evolver: Optional temporal evolver
            use_dual_complex: Whether to use dual-complex attention
            device: Device for computation
            fallback_model: Optional fallback model for error recovery
        """
        super().__init__(
            probe_encoder=probe_encoder,
            ffe_quantizer=ffe_quantizer,
            memory_bank=memory_bank,
            transcender=transcender,
            evolver=evolver,
            use_dual_complex=use_dual_complex,
            device=device,
        )
        self.fallback_model = fallback_model
    
    def forward(
        self,
        input_ids: torch.Tensor,
        timestamps: Optional[torch.Tensor] = None,
    ) -> dict[str, Any]:
        """Forward pass with error handling.
        
        Args:
            input_ids: Input token IDs [batch, seq]
            timestamps: Optional timestamps
        
        Returns:
            Dictionary with output
        """
        try:
            # Validate inputs
            self.validate_inputs(input_ids, timestamps)
            
            # Run pipeline
            result = super().forward(input_ids, timestamps)
            
            # Validate outputs
            self.validate_outputs(result)
            
            return result
            
        except Exception as e:
            # Log error
            logger.error(f"Aurora pipeline error: {e}", exc_info=True)
            
            # Fallback to baseline if available
            if self.fallback_model is not None:
                logger.warning("Falling back to baseline model")
                try:
                    fallback_output = self.fallback_model(input_ids)
                    return {
                        'output': fallback_output,
                        'addresses': [],
                        'memory_entries': [],
                        'fallback': True,
                    }
                except Exception as fallback_error:
                    logger.error(f"Fallback model also failed: {fallback_error}")
            
            raise
    
    def validate_inputs(
        self,
        input_ids: torch.Tensor,
        timestamps: Optional[torch.Tensor] = None,
    ) -> None:
        """Validate input tensors.
        
        Args:
            input_ids: Input token IDs
            timestamps: Optional timestamps
        
        Raises:
            ValueError: If inputs are invalid
        """
        if not isinstance(input_ids, torch.Tensor):
            raise ValueError(f"input_ids must be torch.Tensor, got {type(input_ids)}")
        
        if input_ids.dim() != 2:
            raise ValueError(f"input_ids must be 2D [batch, seq], got shape {input_ids.shape}")
        
        if input_ids.numel() == 0:
            raise ValueError("input_ids cannot be empty")
        
        if timestamps is not None:
            if not isinstance(timestamps, torch.Tensor):
                raise ValueError(f"timestamps must be torch.Tensor, got {type(timestamps)}")
            
            if timestamps.dim() not in [1, 2]:
                raise ValueError(f"timestamps must be 1D or 2D, got shape {timestamps.shape}")
    
    def validate_outputs(
        self,
        result: dict[str, Any],
    ) -> None:
        """Validate output dictionary.
        
        Args:
            result: Output dictionary
        
        Raises:
            ValueError: If outputs are invalid
        """
        required_keys = ['output', 'addresses', 'memory_entries']
        for key in required_keys:
            if key not in result:
                raise ValueError(f"Missing required output key: {key}")
        
        if not isinstance(result['output'], torch.Tensor):
            raise ValueError(f"output must be torch.Tensor, got {type(result['output'])}")
        
        if not isinstance(result['addresses'], list):
            raise ValueError(f"addresses must be list, got {type(result['addresses'])}")
