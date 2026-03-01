"""Sierpinski lattice addressing for discrete memory addresses.

Provides hierarchical address space using Sierpinski lattice structure.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore

from aurora_genesis_core.memory.ffe_quantization import FFEAddress


if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.memory.lattice_addressing requires torch. "
        "Install project dependencies so `torch` is available."
    )


@dataclass
class SierpinskiLatticeAddress:
    """Sierpinski lattice address format.
    
    Address: (level, index, sub_index)
    - level: Hierarchical level (0 = root, higher = finer)
    - index: Index within level
    - sub_index: Sub-position within cell
    """
    level: int      # 0-7 (3 bits)
    index: int      # 0-511 (9 bits)
    sub_index: int  # 0-3 (2 bits)
    
    def to_ffe_address(self) -> FFEAddress:
        """Convert to FFE address format."""
        from aurora_genesis_core.memory.ffe_quantization import FFEAddress
        return FFEAddress(
            level=self.level,
            index=self.index,
            sub_index=self.sub_index,
        )
    
    @classmethod
    def from_ffe_address(cls, ffe_addr: FFEAddress) -> SierpinskiLatticeAddress:
        """Create from FFE address."""
        return cls(
            level=ffe_addr.level,
            index=ffe_addr.index,
            sub_index=ffe_addr.sub_index,
        )
    
    def __repr__(self) -> str:
        return f"SierpinskiLatticeAddress(level={self.level}, index={self.index}, sub_index={self.sub_index})"
    
    def __eq__(self, other) -> bool:
        if not isinstance(other, SierpinskiLatticeAddress):
            return False
        return (
            self.level == other.level and
            self.index == other.index and
            self.sub_index == other.sub_index
        )
    
    def __hash__(self) -> int:
        return hash((self.level, self.index, self.sub_index))


class LatticeAddressing:
    """Sierpinski lattice addressing utilities."""
    
    def __init__(
        self,
        n_levels: int = 8,
        n_per_level: int = 512,
        dim: int = 8,
        seed: int = 1234,
        device: Optional[str] = None,
    ):
        """Initialize lattice addressing.
        
        Args:
            n_levels: Number of hierarchical levels
            n_per_level: Number of centroids per level
            dim: Dimension of centroids
            seed: Random seed
            device: PyTorch device
        """
        self.n_levels = n_levels
        self.n_per_level = n_per_level
        self.dim = dim
        self.seed = seed
        
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device
    
    def address_to_centroid(
        self,
        address: SierpinskiLatticeAddress,
        sierpinski_centroids: torch.Tensor,  # [n_levels, n_per_level, dim]
    ) -> torch.Tensor:
        """Convert lattice address to Sierpinski centroid coordinates.
        
        Args:
            address: Lattice address
            sierpinski_centroids: Pre-computed centroids
        
        Returns:
            centroid: Centroid coordinates [dim]
        """
        if address.level >= sierpinski_centroids.shape[0]:
            raise ValueError(f"Level {address.level} out of range [0, {sierpinski_centroids.shape[0]})")
        if address.index >= sierpinski_centroids.shape[1]:
            raise ValueError(f"Index {address.index} out of range [0, {sierpinski_centroids.shape[1]})")
        
        return sierpinski_centroids[address.level, address.index].clone()
    
    def centroid_to_address(
        self,
        centroid: torch.Tensor,  # [dim]
        sierpinski_centroids: torch.Tensor,  # [n_levels, n_per_level, dim]
    ) -> SierpinskiLatticeAddress:
        """Find nearest lattice address for given centroid.
        
        Args:
            centroid: Centroid coordinates
            sierpinski_centroids: Pre-computed centroids
        
        Returns:
            address: Nearest lattice address
        """
        # Find nearest centroid across all levels
        best_level = 0
        best_index = 0
        best_distance = float('inf')
        
        for level in range(sierpinski_centroids.shape[0]):
            level_centroids = sierpinski_centroids[level]  # [n_per_level, dim]
            
            # Compute distances
            distances = torch.norm(
                level_centroids - centroid.unsqueeze(0),
                dim=1,
            )  # [n_per_level]
            
            # Find minimum
            min_dist, min_idx = torch.min(distances, dim=0)
            min_dist = min_dist.item()
            min_idx = min_idx.item()
            
            if min_dist < best_distance:
                best_distance = min_dist
                best_level = level
                best_index = min_idx
        
        return SierpinskiLatticeAddress(
            level=best_level,
            index=best_index,
            sub_index=0,  # Default sub-index
        )
    
    def get_parent_address(
        self,
        address: SierpinskiLatticeAddress,
    ) -> Optional[SierpinskiLatticeAddress]:
        """Get parent address (one level up).
        
        Args:
            address: Current address
        
        Returns:
            parent: Parent address, or None if at root level
        """
        if address.level == 0:
            return None
        
        # Parent is at level-1, with index divided by branching factor
        # For Sierpinski, branching factor is typically 2^dim
        # Simplified: use index // 2 for now
        parent_index = address.index // 2
        
        return SierpinskiLatticeAddress(
            level=address.level - 1,
            index=parent_index,
            sub_index=0,
        )
    
    def get_child_addresses(
        self,
        address: SierpinskiLatticeAddress,
        max_level: int = 7,
    ) -> list[SierpinskiLatticeAddress]:
        """Get child addresses (one level down).
        
        Args:
            address: Current address
            max_level: Maximum level to generate children
        
        Returns:
            children: List of child addresses
        """
        if address.level >= max_level:
            return []
        
        # Children are at level+1, with indices multiplied by branching factor
        # Simplified: use index * 2 and index * 2 + 1
        child_level = address.level + 1
        base_index = address.index * 2
        
        children = []
        for i in range(2):  # Binary branching
            child_index = base_index + i
            if child_index < self.n_per_level:
                children.append(SierpinskiLatticeAddress(
                    level=child_level,
                    index=child_index,
                    sub_index=0,
                ))
        
        return children
    
    def get_sibling_addresses(
        self,
        address: SierpinskiLatticeAddress,
    ) -> list[SierpinskiLatticeAddress]:
        """Get sibling addresses (same level, different index).
        
        Args:
            address: Current address
        
        Returns:
            siblings: List of sibling addresses
        """
        siblings = []
        
        # Siblings are at same level, with nearby indices
        # For simplicity, return indices ±1 (if valid)
        for offset in [-1, 1]:
            sibling_index = address.index + offset
            if 0 <= sibling_index < self.n_per_level:
                siblings.append(SierpinskiLatticeAddress(
                    level=address.level,
                    index=sibling_index,
                    sub_index=address.sub_index,
                ))
        
        return siblings
    
    def get_nearby_addresses(
        self,
        address: SierpinskiLatticeAddress,
        radius: int = 1,
    ) -> list[SierpinskiLatticeAddress]:
        """Get nearby addresses within radius.
        
        Args:
            address: Center address
            radius: Search radius (in index space)
        
        Returns:
            nearby: List of nearby addresses
        """
        nearby = []
        
        # Search in same level
        for offset in range(-radius, radius + 1):
            nearby_index = address.index + offset
            if 0 <= nearby_index < self.n_per_level:
                nearby.append(SierpinskiLatticeAddress(
                    level=address.level,
                    index=nearby_index,
                    sub_index=address.sub_index,
                ))
        
        return nearby
