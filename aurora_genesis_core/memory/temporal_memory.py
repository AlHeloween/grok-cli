"""Temporal memory banks with evolution support."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import torch

from aurora_genesis_core.memory.lattice_storage import MemoryEntry
from aurora_genesis_core.evolver.screw_theory import ScrewParameters
from aurora_genesis_core.evolver.temporal_evolution import TemporalEvolver


@dataclass
class TemporalMemoryEntry:
    """Memory entry with temporal evolution.
    
    Extends standard memory entry with:
    - Timestamp
    - Screw parameters (omega, v)
    - Evolution history
    """
    entry: MemoryEntry
    timestamp: float
    screw_params: Optional[ScrewParameters] = None
    evolution_history: Optional[list[torch.Tensor]] = None
    
    def __post_init__(self):
        """Initialize evolution history if None."""
        if self.evolution_history is None:
            self.evolution_history = []


class TemporalMemoryBank:
    """Memory bank with temporal evolution support.
    
    Features:
    - Store entries with timestamps
    - Evolve entries forward in time
    - Query with temporal context
    """
    
    def __init__(
        self,
        base_memory_bank,  # LatticeMemoryBank or similar
        device: Optional[str] = None,
    ):
        """Initialize temporal memory bank.
        
        Args:
            base_memory_bank: Base memory bank for storage
            device: Device for computation
        """
        self.base_bank = base_memory_bank
        self.device = device or "cpu"
        
        # Temporal storage: entry_id -> TemporalMemoryEntry
        self._temporal_entries: dict[str, TemporalMemoryEntry] = {}
        self._entry_counter = 0
    
    def add_temporal(
        self,
        entry: MemoryEntry,
        timestamp: float,
        screw_params: Optional[ScrewParameters] = None,
    ) -> str:
        """Add entry with timestamp.
        
        Args:
            entry: Memory entry
            timestamp: Timestamp
            screw_params: Optional screw parameters
        
        Returns:
            Entry ID
        """
        entry_id = f"temporal_{self._entry_counter}"
        self._entry_counter += 1
        
        temporal_entry = TemporalMemoryEntry(
            entry=entry,
            timestamp=timestamp,
            screw_params=screw_params,
        )
        
        self._temporal_entries[entry_id] = temporal_entry
        
        # Also add to base bank
        # (would need address computation in production)
        
        return entry_id
    
    def evolve_entry(
        self,
        entry_id: str,
        target_time: float,
        evolver: TemporalEvolver,
    ) -> Optional[TemporalMemoryEntry]:
        """Evolve entry to target time.
        
        Args:
            entry_id: Entry ID
            target_time: Target time
            evolver: Temporal evolver
        
        Returns:
            Evolved temporal entry, or None if not found
        """
        if entry_id not in self._temporal_entries:
            return None
        
        temporal_entry = self._temporal_entries[entry_id]
        current_time = temporal_entry.timestamp
        
        # Compute time step
        dt = target_time - current_time
        
        if dt <= 0:
            return temporal_entry  # Already at or past target time
        
        # Convert entry to dual-complex tensor
        embedding = torch.tensor(temporal_entry.entry.embedding, device=self.device)
        
        # Create dual-complex tensor (simplified - would use proper encoding)
        from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor, _stack
        z_primal = embedding
        z_dual = torch.zeros_like(embedding)  # Default dual to zero
        z = DualComplexTensor(_stack(z_primal, z_dual))
        
        # Evolve
        z_evolved = evolver(z, dt=dt)
        
        # Create evolved entry
        evolved_embedding = z_evolved.primal.cpu().numpy().tolist()
        evolved_entry = MemoryEntry(
            embedding=evolved_embedding,
            text=temporal_entry.entry.text,
            metadata={
                **temporal_entry.entry.metadata,
                "evolved": True,
                "source_time": current_time,
                "target_time": target_time,
            },
        )
        
        # Create evolved temporal entry
        evolved_temporal = TemporalMemoryEntry(
            entry=evolved_entry,
            timestamp=target_time,
            screw_params=temporal_entry.screw_params,
            evolution_history=temporal_entry.evolution_history + [z_evolved.primal],
        )
        
        return evolved_temporal
    
    def query_temporal(
        self,
        query: torch.Tensor,
        query_time: float,
        k: int = 8,
    ) -> list[TemporalMemoryEntry]:
        """Query with temporal context.
        
        Args:
            query: Query embedding
            query_time: Query time
            k: Number of results
        
        Returns:
            List of temporal memory entries
        """
        # Simplified: return all entries (would use proper similarity search in production)
        results = []
        for entry_id, temporal_entry in self._temporal_entries.items():
            results.append(temporal_entry)
            if len(results) >= k:
                break
        
        return results
