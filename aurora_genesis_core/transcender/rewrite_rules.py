"""Rewrite rules for promoting leaf clusters to higher levels."""

from __future__ import annotations

from typing import Optional
import torch

from aurora_genesis_core.memory.lattice_storage import MemoryEntry
from aurora_genesis_core.transcender.triplet_synthesis import TripletOperator


class RewriteRule:
    """Rewrite rule for promoting leaf clusters to higher levels.
    
    Rules determine:
    - When to promote (triggers)
    - Which entries to combine (selection)
    - How to synthesize (method)
    - Where to place result (target level)
    """
    
    def __init__(
        self,
        trigger_type: str = "count",  # "count", "similarity", "time", "information"
        threshold: float = 3.0,  # Threshold for trigger
        selection_method: str = "similarity",  # "similarity", "clustering", "diversity", "hierarchical"
        synthesis_method: str = "mean",  # Synthesis method for triplet operator
        device: str = "cpu",
    ):
        """Initialize rewrite rule.
        
        Args:
            trigger_type: Type of promotion trigger
            threshold: Threshold value for trigger
            selection_method: Method for selecting triplets
            synthesis_method: Method for synthesizing triplets
            device: Device for computation
        """
        self.trigger_type = trigger_type
        self.threshold = threshold
        self.selection_method = selection_method
        self.synthesis_method = synthesis_method
        self.device = device
        
        # Triplet operator for synthesis
        self.triplet_operator = TripletOperator(
            method=synthesis_method,
            device=device,
        )
    
    def should_promote(
        self,
        level: int,
        entries: list[MemoryEntry],
    ) -> bool:
        """Determine if promotion should occur.
        
        Args:
            level: Current level
            entries: List of entries at level
        
        Returns:
            True if promotion should occur
        """
        if not entries or len(entries) < 3:
            return False
        
        if self.trigger_type == "count":
            # Promote when level has N entries
            return len(entries) >= int(self.threshold)
        
        elif self.trigger_type == "similarity":
            # Promote when entries are similar (average similarity > threshold)
            if len(entries) < 3:
                return False
            avg_similarity = self._compute_average_similarity(entries)
            return avg_similarity >= self.threshold
        
        elif self.trigger_type == "time":
            # Promote after time interval (simplified - would use timestamps)
            # For now, use count as proxy
            return len(entries) >= int(self.threshold)
        
        elif self.trigger_type == "information":
            # Promote when information density high
            # Simplified: use count as proxy
            return len(entries) >= int(self.threshold)
        
        return False
    
    def select_triplets(
        self,
        entries: list[MemoryEntry],
    ) -> list[tuple[MemoryEntry, MemoryEntry, MemoryEntry]]:
        """Select triplets for synthesis.
        
        Args:
            entries: List of entries to select from
        
        Returns:
            List of (A, B, C) triplets
        """
        if len(entries) < 3:
            return []
        
        triplets = []
        
        if self.selection_method == "similarity":
            # Select most similar entries
            triplets = self._select_by_similarity(entries)
        
        elif self.selection_method == "clustering":
            # Select entries from same cluster
            triplets = self._select_by_clustering(entries)
        
        elif self.selection_method == "diversity":
            # Select diverse entries for better compression
            triplets = self._select_by_diversity(entries)
        
        elif self.selection_method == "hierarchical":
            # Select from child nodes (would need hierarchical structure)
            triplets = self._select_by_hierarchical(entries)
        
        else:
            # Default: sequential triplets
            for i in range(0, len(entries) - 2, 3):
                triplets.append((entries[i], entries[i+1], entries[i+2]))
        
        return triplets
    
    def apply_rewrite(
        self,
        triplet: tuple[MemoryEntry, MemoryEntry, MemoryEntry],
        target_level: int,
    ) -> MemoryEntry:
        """Apply rewrite rule to create higher-order node.
        
        Args:
            triplet: (A, B, C) triplet
            target_level: Target level for promotion
        
        Returns:
            Synthesized memory entry
        """
        entry_a, entry_b, entry_c = triplet
        
        # Synthesize using triplet operator
        synthesized = self.triplet_operator(entry_a, entry_b, entry_c)
        
        # Add target level to metadata
        if synthesized.metadata is None:
            synthesized.metadata = {}
        synthesized.metadata["target_level"] = target_level
        synthesized.metadata["promoted"] = True
        
        return synthesized
    
    def _compute_average_similarity(self, entries: list[MemoryEntry]) -> float:
        """Compute average similarity between entries.
        
        Args:
            entries: List of entries
        
        Returns:
            Average cosine similarity
        """
        if len(entries) < 2:
            return 0.0
        
        similarities = []
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                emb_i = torch.tensor(entries[i].embedding, dtype=torch.float32)
                emb_j = torch.tensor(entries[j].embedding, dtype=torch.float32)
                
                # Cosine similarity
                dot_product = torch.dot(emb_i, emb_j)
                norm_i = torch.norm(emb_i)
                norm_j = torch.norm(emb_j)
                
                if norm_i > 0 and norm_j > 0:
                    similarity = (dot_product / (norm_i * norm_j)).item()
                    similarities.append(similarity)
        
        return sum(similarities) / len(similarities) if similarities else 0.0
    
    def _select_by_similarity(
        self,
        entries: list[MemoryEntry],
    ) -> list[tuple[MemoryEntry, MemoryEntry, MemoryEntry]]:
        """Select triplets by similarity (most similar entries).
        
        Args:
            entries: List of entries
        
        Returns:
            List of triplets
        """
        if len(entries) < 3:
            return []
        
        # Compute pairwise similarities
        similarities = []
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                emb_i = torch.tensor(entries[i].embedding, dtype=torch.float32)
                emb_j = torch.tensor(entries[j].embedding, dtype=torch.float32)
                
                dot_product = torch.dot(emb_i, emb_j)
                norm_i = torch.norm(emb_i)
                norm_j = torch.norm(emb_j)
                
                similarity = (dot_product / (norm_i * norm_j)).item() if norm_i > 0 and norm_j > 0 else 0.0
                similarities.append((similarity, i, j))
        
        # Sort by similarity (descending)
        similarities.sort(reverse=True, key=lambda x: x[0])
        
        # Select top triplets
        triplets = []
        used_indices = set()
        
        for similarity, i, j in similarities:
            if i in used_indices or j in used_indices:
                continue
            
            # Find third entry (most similar to either i or j)
            best_k = None
            best_sim = -1.0
            for k in range(len(entries)):
                if k == i or k == j or k in used_indices:
                    continue
                
                emb_k = torch.tensor(entries[k].embedding, dtype=torch.float32)
                emb_i = torch.tensor(entries[i].embedding, dtype=torch.float32)
                
                dot_product = torch.dot(emb_i, emb_k)
                norm_i = torch.norm(emb_i)
                norm_k = torch.norm(emb_k)
                
                sim = (dot_product / (norm_i * norm_k)).item() if norm_i > 0 and norm_k > 0 else 0.0
                if sim > best_sim:
                    best_sim = sim
                    best_k = k
            
            if best_k is not None:
                triplets.append((entries[i], entries[j], entries[best_k]))
                used_indices.add(i)
                used_indices.add(j)
                used_indices.add(best_k)
        
        return triplets
    
    def _select_by_clustering(
        self,
        entries: list[MemoryEntry],
    ) -> list[tuple[MemoryEntry, MemoryEntry, MemoryEntry]]:
        """Select triplets by clustering (entries from same cluster).
        
        Args:
            entries: List of entries
        
        Returns:
            List of triplets
        """
        # Simplified: use similarity-based selection
        return self._select_by_similarity(entries)
    
    def _select_by_diversity(
        self,
        entries: list[MemoryEntry],
    ) -> list[tuple[MemoryEntry, MemoryEntry, MemoryEntry]]:
        """Select triplets by diversity (diverse entries).
        
        Args:
            entries: List of entries
        
        Returns:
            List of triplets
        """
        if len(entries) < 3:
            return []
        
        # Select diverse entries (low similarity)
        triplets = []
        for i in range(0, len(entries) - 2, 3):
            # Select entries that are not too similar
            triplets.append((entries[i], entries[i+1], entries[i+2]))
        
        return triplets
    
    def _select_by_hierarchical(
        self,
        entries: list[MemoryEntry],
    ) -> list[tuple[MemoryEntry, MemoryEntry, MemoryEntry]]:
        """Select triplets by hierarchical structure.
        
        Args:
            entries: List of entries
        
        Returns:
            List of triplets
        """
        # Simplified: use sequential selection
        triplets = []
        for i in range(0, len(entries) - 2, 3):
            triplets.append((entries[i], entries[i+1], entries[i+2]))
        return triplets
