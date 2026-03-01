"""Persistent storage using Sierpinski lattice addressing.

Provides efficient leaf node storage with address-based indexing.
"""

from __future__ import annotations

import pickle
import struct
from pathlib import Path
from typing import Optional

from aurora_genesis_core.memory.lattice_addressing import SierpinskiLatticeAddress


class MemoryEntry:
    """Memory entry stored in lattice."""
    
    def __init__(
        self,
        embedding: list[float],  # Dual quaternion [8]
        text: Optional[str] = None,
        metadata: Optional[dict] = None,
    ):
        self.embedding = embedding
        self.text = text
        self.metadata = metadata or {}
    
    def __repr__(self) -> str:
        return f"MemoryEntry(text={self.text[:50] if self.text else None}, embedding_len={len(self.embedding)})"


class LatticeMemoryStorage:
    """Persistent storage using Sierpinski lattice addressing.
    
    Format:
    - Leaf nodes: Store actual memory entries
    - Internal nodes: Aggregated summaries (via Transcender in Phase 4)
    - Address-based indexing for fast lookup
    """
    
    def __init__(
        self,
        storage_path: Optional[Path | str] = None,
        n_levels: int = 8,
        n_per_level: int = 512,
    ):
        """Initialize lattice storage.
        
        Args:
            storage_path: Path to storage file (None = in-memory only)
            n_levels: Number of hierarchical levels
            n_per_level: Number of centroids per level
        """
        self.storage_path = Path(storage_path) if storage_path else None
        self.n_levels = n_levels
        self.n_per_level = n_per_level
        
        # Storage: address -> list of entries (leaf nodes can have multiple entries)
        self._storage: dict[SierpinskiLatticeAddress, list[MemoryEntry]] = {}
        
        # Load from file if exists
        if self.storage_path and self.storage_path.exists():
            self.load()
    
    def write_leaf(
        self,
        address: SierpinskiLatticeAddress,
        entry: MemoryEntry,
    ) -> bool:
        """Write memory entry to leaf node.
        
        Args:
            address: Lattice address
            entry: Memory entry to store
        
        Returns:
            True if successful
        """
        if address not in self._storage:
            self._storage[address] = []
        
        self._storage[address].append(entry)
        return True
    
    def read_leaf(
        self,
        address: SierpinskiLatticeAddress,
    ) -> Optional[list[MemoryEntry]]:
        """Read memory entries from leaf node.
        
        Args:
            address: Lattice address
        
        Returns:
            List of memory entries, or None if not found
        """
        return self._storage.get(address, None)
    
    def has_leaf(
        self,
        address: SierpinskiLatticeAddress,
    ) -> bool:
        """Check if leaf node exists.
        
        Args:
            address: Lattice address
        
        Returns:
            True if leaf exists
        """
        return address in self._storage and len(self._storage[address]) > 0
    
    def get_all_addresses(self) -> list[SierpinskiLatticeAddress]:
        """Get all addresses that have entries.
        
        Returns:
            List of addresses
        """
        return list(self._storage.keys())
    
    def get_entry_count(self, address: SierpinskiLatticeAddress) -> int:
        """Get number of entries at address.
        
        Args:
            address: Lattice address
        
        Returns:
            Number of entries
        """
        if address not in self._storage:
            return 0
        return len(self._storage[address])
    
    def batch_write(
        self,
        entries: list[tuple[SierpinskiLatticeAddress, MemoryEntry]],
    ) -> int:
        """Batch write entries.
        
        Args:
            entries: List of (address, entry) tuples
        
        Returns:
            Number of entries written
        """
        count = 0
        for address, entry in entries:
            if self.write_leaf(address, entry):
                count += 1
        return count
    
    def range_query(
        self,
        level: int,
        start_index: int = 0,
        end_index: Optional[int] = None,
    ) -> list[tuple[SierpinskiLatticeAddress, list[MemoryEntry]]]:
        """Query entries in a range.
        
        Args:
            level: Level to query
            start_index: Start index (inclusive)
            end_index: End index (exclusive, None = end of level)
        
        Returns:
            List of (address, entries) tuples
        """
        if end_index is None:
            end_index = self.n_per_level
        
        results = []
        for index in range(start_index, end_index):
            address = SierpinskiLatticeAddress(
                level=level,
                index=index,
                sub_index=0,
            )
            entries = self.read_leaf(address)
            if entries:
                results.append((address, entries))
        
        return results
    
    def level_entries(
        self,
        level: int,
    ) -> list[tuple[SierpinskiLatticeAddress, list[MemoryEntry]]]:
        """Get all entries at a specific level.
        
        Args:
            level: Level to query
        
        Returns:
            List of (address, entries) tuples
        """
        results = []
        for address, entries in self._storage.items():
            if address.level == level:
                results.append((address, entries))
        return results
    
    def save(self, path: Optional[Path | str] = None) -> bool:
        """Save storage to file.
        
        Args:
            path: Optional path (uses self.storage_path if None)
        
        Returns:
            True if successful
        """
        save_path = Path(path) if path else self.storage_path
        if not save_path:
            return False
        
        # Create parent directory if needed
        save_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Serialize storage
        data = {
            'n_levels': self.n_levels,
            'n_per_level': self.n_per_level,
            'storage': self._storage,
        }
        
        with open(save_path, 'wb') as f:
            pickle.dump(data, f)
        
        return True
    
    def load(self, path: Optional[Path | str] = None) -> bool:
        """Load storage from file.
        
        Args:
            path: Optional path (uses self.storage_path if None)
        
        Returns:
            True if successful
        """
        load_path = Path(path) if path else self.storage_path
        if not load_path or not load_path.exists():
            return False
        
        with open(load_path, 'rb') as f:
            data = pickle.load(f)
        
        self.n_levels = data.get('n_levels', self.n_levels)
        self.n_per_level = data.get('n_per_level', self.n_per_level)
        self._storage = data.get('storage', {})
        
        # Convert dict keys back to SierpinskiLatticeAddress
        # (pickle may have serialized them as tuples)
        converted_storage = {}
        for key, value in self._storage.items():
            if isinstance(key, tuple):
                address = SierpinskiLatticeAddress(*key)
            elif isinstance(key, dict):
                address = SierpinskiLatticeAddress(**key)
            else:
                address = key
            converted_storage[address] = value
        self._storage = converted_storage
        
        return True
    
    def clear(self) -> None:
        """Clear all storage."""
        self._storage.clear()
    
    def get_stats(self) -> dict:
        """Get storage statistics.
        
        Returns:
            Dictionary with statistics
        """
        total_entries = sum(len(entries) for entries in self._storage.values())
        level_counts = {}
        for address in self._storage.keys():
            level_counts[address.level] = level_counts.get(address.level, 0) + 1
        
        return {
            'total_addresses': len(self._storage),
            'total_entries': total_entries,
            'level_counts': level_counts,
            'n_levels': self.n_levels,
            'n_per_level': self.n_per_level,
        }
