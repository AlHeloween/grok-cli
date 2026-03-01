"""Deterministic aggregation policy for lattice structure.

Provides aggregation methods for combining children entries into parent nodes.
"""

from __future__ import annotations

from typing import Literal

try:
    import torch
    import torch.nn as nn
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore
    nn = None  # type: ignore

from aurora_genesis_core.memory.lattice_storage import MemoryEntry


if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.memory.lattice_aggregation requires torch. "
        "Install project dependencies so `torch` is available."
    )


class LatticeAggregationPolicy:
    """Deterministic aggregation policy for lattice structure.
    
    Rules:
    - Leaf nodes: Store individual entries
    - Level N: Aggregate from level N+1 children
    - Aggregation: Mean, max, or learned aggregation
    """
    
    def __init__(
        self,
        method: Literal['mean', 'max', 'dual_quaternion'] = 'mean',
    ):
        """Initialize aggregation policy.
        
        Args:
            method: Aggregation method
                - 'mean': Simple average
                - 'max': Maximum (selective)
                - 'dual_quaternion': Hamilton product mean
        """
        self.method = method
    
    def aggregate_level(
        self,
        level: int,
        children_entries: list[MemoryEntry],
    ) -> MemoryEntry:
        """Aggregate children entries into parent node.
        
        Args:
            level: Target level (parent level)
            children_entries: List of child entries
        
        Returns:
            Aggregated memory entry
        """
        if not children_entries:
            # Return empty entry if no children
            return MemoryEntry(
                embedding=[0.0] * 8,
                text=None,
                metadata={'level': level, 'aggregated': True},
            )
        
        if self.method == 'mean':
            return self._aggregate_mean(children_entries, level)
        elif self.method == 'max':
            return self._aggregate_max(children_entries, level)
        elif self.method == 'dual_quaternion':
            return self._aggregate_dual_quaternion(children_entries, level)
        else:
            raise ValueError(f"Unknown aggregation method: {self.method}")
    
    def _aggregate_mean(
        self,
        entries: list[MemoryEntry],
        level: int,
    ) -> MemoryEntry:
        """Mean aggregation: simple average of embeddings.
        
        Args:
            entries: List of entries
            level: Target level
        
        Returns:
            Aggregated entry
        """
        if not entries:
            return MemoryEntry(embedding=[0.0] * 8, metadata={'level': level})
        
        # Average embeddings
        embeddings = torch.tensor([e.embedding for e in entries], dtype=torch.float32)
        mean_embedding = torch.mean(embeddings, dim=0).tolist()
        
        # Combine text (concatenate or use first)
        combined_text = " | ".join([e.text for e in entries if e.text])
        
        # Combine metadata
        combined_metadata = {
            'level': level,
            'aggregated': True,
            'method': 'mean',
            'n_children': len(entries),
        }
        
        return MemoryEntry(
            embedding=mean_embedding,
            text=combined_text if combined_text else None,
            metadata=combined_metadata,
        )
    
    def _aggregate_max(
        self,
        entries: list[MemoryEntry],
        level: int,
    ) -> MemoryEntry:
        """Max aggregation: select entry with maximum norm.
        
        Args:
            entries: List of entries
            level: Target level
        
        Returns:
            Aggregated entry (selected entry)
        """
        if not entries:
            return MemoryEntry(embedding=[0.0] * 8, metadata={'level': level})
        
        # Find entry with maximum embedding norm
        max_norm = -1.0
        max_entry = None
        
        for entry in entries:
            norm = sum(x * x for x in entry.embedding)
            if norm > max_norm:
                max_norm = norm
                max_entry = entry
        
        # Return selected entry with updated metadata
        aggregated = MemoryEntry(
            embedding=max_entry.embedding.copy(),
            text=max_entry.text,
            metadata={
                **max_entry.metadata,
                'level': level,
                'aggregated': True,
                'method': 'max',
                'n_children': len(entries),
            },
        )
        
        return aggregated
    
    def _aggregate_dual_quaternion(
        self,
        entries: list[MemoryEntry],
        level: int,
    ) -> MemoryEntry:
        """Dual quaternion aggregation: Hamilton product mean.
        
        Args:
            entries: List of entries
            level: Target level
        
        Returns:
            Aggregated entry
        """
        if not entries:
            return MemoryEntry(embedding=[0.0] * 8, metadata={'level': level})
        
        # Convert embeddings to dual quaternions
        # For simplicity, use mean (full Hamilton product mean would require
        # proper dual quaternion operations)
        embeddings = torch.tensor([e.embedding for e in entries], dtype=torch.float32)
        
        # Normalize each dual quaternion (unit quaternion)
        norms = torch.norm(embeddings, dim=1, keepdim=True)
        normalized = embeddings / (norms + 1e-8)
        
        # Mean of normalized dual quaternions
        mean_embedding = torch.mean(normalized, dim=0)
        
        # Renormalize result
        result_norm = torch.norm(mean_embedding)
        if result_norm > 1e-8:
            mean_embedding = mean_embedding / result_norm
        
        # Combine text
        combined_text = " | ".join([e.text for e in entries if e.text])
        
        # Combine metadata
        combined_metadata = {
            'level': level,
            'aggregated': True,
            'method': 'dual_quaternion',
            'n_children': len(entries),
        }
        
        return MemoryEntry(
            embedding=mean_embedding.tolist(),
            text=combined_text if combined_text else None,
            metadata=combined_metadata,
        )
    
    def is_deterministic(self) -> bool:
        """Check if aggregation is deterministic.
        
        Returns:
            True if deterministic
        """
        return self.method in ['mean', 'max', 'dual_quaternion']
