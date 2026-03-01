"""Integration of Evolver with Aurora pipeline."""

from __future__ import annotations

from typing import Optional
import torch
import torch.nn as nn

from aurora_genesis_core.evolver.temporal_evolution import TemporalEvolver
from aurora_genesis_core.memory.temporal_memory import TemporalMemoryBank
from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor, _stack


class EvolverIntegration:
    """Integration of Evolver with Aurora pipeline."""
    
    def __init__(
        self,
        model: nn.Module,
        evolver: TemporalEvolver,
        memory_bank: TemporalMemoryBank,
    ):
        """Initialize evolver integration.
        
        Args:
            model: Base model (encoder/decoder)
            evolver: Temporal evolver
            memory_bank: Temporal memory bank
        """
        self.model = model
        self.evolver = evolver
        self.memory_bank = memory_bank
    
    def process_temporal_sequence(
        self,
        sequence: torch.Tensor,
        timestamps: torch.Tensor,
    ) -> torch.Tensor:
        """Process temporal sequence with evolution.
        
        Args:
            sequence: Input sequence [batch, seq, dim]
            timestamps: Timestamps [seq] or [batch, seq]
        
        Returns:
            Processed sequence
        """
        # 1. Encode sequence (simplified - would use actual model.encode)
        # For now, use sequence directly
        z_primal = sequence.mean(dim=1)  # [batch, dim]
        z_dual = torch.zeros_like(z_primal)
        z = DualComplexTensor(_stack(z_primal, z_dual))
        
        # 2. Evolve forward in time
        if timestamps.dim() == 1:
            dt = timestamps[-1] - timestamps[0] if len(timestamps) > 1 else 1.0
        else:
            dt = timestamps[:, -1] - timestamps[:, 0]
        
        z_evolved = self.evolver(z, dt=dt)
        
        # 3. Store in memory with temporal context
        from aurora_genesis_core.memory.lattice_storage import MemoryEntry
        
        for i in range(z_evolved.primal.shape[0]):
            entry = MemoryEntry(
                embedding=z_evolved.primal[i].cpu().numpy().tolist(),
                text=None,
                metadata={"temporal": True},
            )
            timestamp = timestamps[-1].item() if timestamps.dim() == 1 else timestamps[i, -1].item()
            self.memory_bank.add_temporal(entry, timestamp)
        
        # 4. Decode (simplified - would use actual model.decode)
        return z_evolved.primal.unsqueeze(1).expand_as(sequence)
