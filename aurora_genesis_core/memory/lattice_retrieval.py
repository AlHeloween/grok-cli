"""Memory retrieval via lattice addresses.

Provides efficient address-based retrieval with hierarchical search.
"""

from __future__ import annotations

from typing import Optional

from aurora_genesis_core.memory.lattice_addressing import (
    SierpinskiLatticeAddress,
    LatticeAddressing,
)
from aurora_genesis_core.memory.lattice_storage import LatticeMemoryStorage, MemoryEntry


class LatticeRetrieval:
    """Address-based retrieval using lattice addressing."""
    
    def __init__(
        self,
        storage: LatticeMemoryStorage,
        addressing: LatticeAddressing,
    ):
        """Initialize retrieval system.
        
        Args:
            storage: Lattice storage instance
            addressing: Lattice addressing instance
        """
        self.storage = storage
        self.addressing = addressing
    
    def retrieve_by_address(
        self,
        query_address: SierpinskiLatticeAddress,
        k: int,
        candidate_slots: int = 4,
    ) -> list[MemoryEntry]:
        """Retrieve k nearest entries using lattice addressing.
        
        Args:
            query_address: Query address
            k: Number of entries to retrieve
            candidate_slots: Number of candidate slots to search
        
        Returns:
            List of memory entries (up to k)
        """
        # 1. Find candidate addresses (same level, nearby indices)
        candidates = self._find_candidate_addresses(query_address, candidate_slots)
        
        # 2. Read entries from candidate addresses
        all_entries = []
        for addr in candidates:
            entries = self.storage.read_leaf(addr)
            if entries:
                all_entries.extend(entries)
        
        # 3. Compute similarity (for now, just return all entries)
        # In production, would compute similarity and rank
        # 4. Return top-k
        return all_entries[:k]
    
    def _find_candidate_addresses(
        self,
        query_address: SierpinskiLatticeAddress,
        candidate_slots: int,
    ) -> list[SierpinskiLatticeAddress]:
        """Find candidate addresses for retrieval.
        
        Args:
            query_address: Query address
            candidate_slots: Number of candidate slots
        
        Returns:
            List of candidate addresses
        """
        candidates = []
        
        # Start with query address itself
        if self.storage.has_leaf(query_address):
            candidates.append(query_address)
        
        # Add nearby addresses at same level
        nearby = self.addressing.get_nearby_addresses(query_address, radius=1)
        for addr in nearby:
            if self.storage.has_leaf(addr) and addr not in candidates:
                candidates.append(addr)
        
        # Add siblings
        siblings = self.addressing.get_sibling_addresses(query_address)
        for addr in siblings:
            if self.storage.has_leaf(addr) and addr not in candidates:
                candidates.append(addr)
        
        # If not enough candidates, search parent level
        if len(candidates) < candidate_slots:
            parent = self.addressing.get_parent_address(query_address)
            if parent and self.storage.has_leaf(parent):
                if parent not in candidates:
                    candidates.append(parent)
        
        # If still not enough, search child level
        if len(candidates) < candidate_slots:
            children = self.addressing.get_child_addresses(query_address)
            for child in children:
                if self.storage.has_leaf(child) and child not in candidates:
                    candidates.append(child)
                    if len(candidates) >= candidate_slots:
                        break
        
        return candidates[:candidate_slots]
    
    def hierarchical_retrieve(
        self,
        query_address: SierpinskiLatticeAddress,
        k: int,
        start_level: Optional[int] = None,
    ) -> list[MemoryEntry]:
        """Hierarchical retrieval: start at coarse level, refine to fine level.
        
        Args:
            query_address: Query address
            k: Number of entries to retrieve
            start_level: Starting level (None = use query level)
        
        Returns:
            List of memory entries
        """
        if start_level is None:
            start_level = query_address.level
        
        # Start at coarse level (higher level = coarser)
        # Search from root (level 0) down to query level
        all_entries = []
        
        for level in range(start_level, query_address.level + 1):
            # Create address at this level
            level_address = SierpinskiLatticeAddress(
                level=level,
                index=query_address.index // (2 ** (query_address.level - level)),
                sub_index=0,
            )
            
            # Retrieve entries at this level
            entries = self.storage.read_leaf(level_address)
            if entries:
                all_entries.extend(entries)
            
            # If we have enough, break
            if len(all_entries) >= k:
                break
        
        return all_entries[:k]
    
    def batch_retrieve(
        self,
        query_addresses: list[SierpinskiLatticeAddress],
        k: int,
        candidate_slots: int = 4,
    ) -> list[list[MemoryEntry]]:
        """Batch retrieval for multiple queries.
        
        Args:
            query_addresses: List of query addresses
            k: Number of entries per query
            candidate_slots: Number of candidate slots per query
        
        Returns:
            List of entry lists (one per query)
        """
        results = []
        for query_addr in query_addresses:
            entries = self.retrieve_by_address(query_addr, k, candidate_slots)
            results.append(entries)
        return results
