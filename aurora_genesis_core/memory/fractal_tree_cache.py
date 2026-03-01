"""Fractal tree cache for Navigation paradigm optimization.

Caches fractal tree structure to avoid rebuilding on each query.
"""

from __future__ import annotations

from typing import Optional, Dict, List
import torch
from collections import OrderedDict

from aurora_genesis_core.memory.lattice_addressing import (
    SierpinskiLatticeAddress,
    LatticeAddressing,
)
from aurora_genesis_core.memory.lattice_storage import LatticeMemoryStorage, MemoryEntry
from aurora_genesis_core.memory.fractal_context_engine import FractalNode


class FractalTreeCache:
    """
    Cache for fractal tree structure to optimize Navigation paradigm.
    
    Caches:
    - Fractal tree nodes by address
    - Dual quaternion embeddings
    - Conjugate pre-computations
    - Temporal decay factors
    """
    
    def __init__(
        self,
        max_cache_size: int = 1000,
        enable_conjugate_cache: bool = True,
    ):
        """
        Initialize fractal tree cache.
        
        Args:
            max_cache_size: Maximum number of nodes to cache
            enable_conjugate_cache: If True, cache dual quaternion conjugates
        """
        self.max_cache_size = max_cache_size
        self.enable_conjugate_cache = enable_conjugate_cache
        
        # Cache: address -> FractalNode
        self.node_cache: OrderedDict[str, FractalNode] = OrderedDict()
        
        # Cache: embedding -> conjugate
        self.conjugate_cache: Dict[str, torch.Tensor] = {}
        
        # Cache: address -> temporal_decay_factor
        self.temporal_decay_cache: Dict[str, float] = {}
        
        # Statistics
        self.cache_hits = 0
        self.cache_misses = 0
    
    def _address_to_key(self, address: SierpinskiLatticeAddress) -> str:
        """Convert address to cache key."""
        return f"{address.level}_{address.index}_{address.sub_index}"
    
    def get_node(
        self,
        address: SierpinskiLatticeAddress,
        storage: LatticeMemoryStorage,
        addressing: LatticeAddressing,
        max_level: int = 7,
    ) -> Optional[FractalNode]:
        """
        Get node from cache or build if not cached.
        
        Args:
            address: Node address
            storage: Lattice memory storage
            addressing: Lattice addressing utilities
            max_level: Maximum level to build
            
        Returns:
            FractalNode or None if no data
        """
        key = self._address_to_key(address)
        
        # Check cache
        if key in self.node_cache:
            # Move to end (LRU)
            node = self.node_cache.pop(key)
            self.node_cache[key] = node
            self.cache_hits += 1
            return node
        
        # Cache miss - build node
        self.cache_misses += 1
        node = self._build_node(address, storage, addressing, max_level)
        
        if node is not None:
            # Add to cache (evict oldest if full)
            if len(self.node_cache) >= self.max_cache_size:
                self.node_cache.popitem(last=False)  # Remove oldest
            self.node_cache[key] = node
        
        return node
    
    def _build_node(
        self,
        address: SierpinskiLatticeAddress,
        storage: LatticeMemoryStorage,
        addressing: LatticeAddressing,
        max_level: int = 7,
    ) -> Optional[FractalNode]:
        """Build a single node (same logic as FractalContextEngine._build_node)."""
        if address.level > max_level:
            return None
        
        # Read entry from storage
        entries = storage.read_leaf(address)
        
        # Extract embedding from entry (if available)
        embedding = None
        embedding_dual = None
        entry = None
        
        if entries:
            entry = entries[0]
            if entry.embedding:
                embedding = torch.tensor(
                    entry.embedding[:8],
                    dtype=torch.float32,
                )
                embedding_dual = torch.zeros(8, dtype=torch.float32)
        
        # Build children if not at max level
        children = []
        if address.level < max_level:
            child_addresses = addressing.get_child_addresses(
                address,
                max_level=max_level,
            )
            for child_addr in child_addresses:
                child_node = self.get_node(child_addr, storage, addressing, max_level)
                if child_node is not None:
                    children.append(child_node)
        
        return FractalNode(
            address=address,
            embedding=embedding,
            embedding_dual=embedding_dual,
            children=children,
            entry=entry,
        )
    
    def get_conjugate(self, embedding: torch.Tensor) -> torch.Tensor:
        """
        Get conjugate of dual quaternion (cached).
        
        Args:
            embedding: Dual quaternion embedding [8]
            
        Returns:
            Conjugate dual quaternion [8]
        """
        if not self.enable_conjugate_cache:
            return self._compute_conjugate(embedding)
        
        # Create cache key from embedding data
        key = str(embedding.cpu().numpy().tobytes())
        
        if key in self.conjugate_cache:
            self.cache_hits += 1
            return self.conjugate_cache[key]
        
        # Compute and cache
        self.cache_misses += 1
        conjugate = self._compute_conjugate(embedding)
        self.conjugate_cache[key] = conjugate
        
        # Limit cache size
        if len(self.conjugate_cache) > self.max_cache_size:
            # Remove oldest (simple FIFO)
            oldest_key = next(iter(self.conjugate_cache))
            del self.conjugate_cache[oldest_key]
        
        return conjugate
    
    def _compute_conjugate(self, embedding: torch.Tensor) -> torch.Tensor:
        """Compute dual quaternion conjugate."""
        from aurora_genesis_core.probe.dual_quaternion import dual_quat_conjugate, DualQuaternionTensor
        
        dq = DualQuaternionTensor(embedding)
        conj = dual_quat_conjugate(dq)
        return conj.data
    
    def get_temporal_decay(
        self,
        address: SierpinskiLatticeAddress,
        entry: MemoryEntry,
        current_time: float,
        decay_lambda: float = 0.01,
    ) -> float:
        """
        Get temporal decay factor (cached).
        
        Args:
            address: Node address
            entry: Memory entry with metadata
            current_time: Current time
            decay_lambda: Decay rate
            
        Returns:
            Decay factor (0.0 to 1.0)
        """
        key = self._address_to_key(address)
        
        # Get entry timestamp from metadata
        entry_time = entry.metadata.get("timestamp", 0.0) if entry.metadata else 0.0
        
        # Compute time difference
        dt = current_time - entry_time
        
        # Check cache
        cache_key = f"{key}_{dt:.2f}"  # Include dt for cache key
        if cache_key in self.temporal_decay_cache:
            return self.temporal_decay_cache[cache_key]
        
        # Compute decay factor: exp(-λ * dt)
        decay_factor = float(torch.exp(-decay_lambda * dt).item())
        
        # Cache (limit size)
        if len(self.temporal_decay_cache) > self.max_cache_size:
            oldest_key = next(iter(self.temporal_decay_cache))
            del self.temporal_decay_cache[oldest_key]
        
        self.temporal_decay_cache[cache_key] = decay_factor
        return decay_factor
    
    def clear(self) -> None:
        """Clear all caches."""
        self.node_cache.clear()
        self.conjugate_cache.clear()
        self.temporal_decay_cache.clear()
        self.cache_hits = 0
        self.cache_misses = 0
    
    def get_stats(self) -> Dict[str, float]:
        """Get cache statistics."""
        total = self.cache_hits + self.cache_misses
        hit_rate = (self.cache_hits / total * 100.0) if total > 0 else 0.0
        
        return {
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "hit_rate": hit_rate,
            "node_cache_size": len(self.node_cache),
            "conjugate_cache_size": len(self.conjugate_cache),
            "temporal_decay_cache_size": len(self.temporal_decay_cache),
        }
