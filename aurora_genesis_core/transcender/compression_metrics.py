"""Compression metrics for measuring quality and information loss."""

from __future__ import annotations

from typing import Optional
import torch
import numpy as np

from aurora_genesis_core.memory.lattice_storage import MemoryEntry


class CompressionMetrics:
    """Metrics for measuring compression quality and information loss."""
    
    def __init__(
        self,
        max_information_loss: float = 0.1,
        min_compression_ratio: float = 0.5,
        device: str = "cpu",
    ):
        """Initialize compression metrics.
        
        Args:
            max_information_loss: Maximum acceptable information loss (0-1)
            min_compression_ratio: Minimum compression ratio (0-1)
            device: Device for computation
        """
        self.max_information_loss = max_information_loss
        self.min_compression_ratio = min_compression_ratio
        self.device = device
    
    def compute_information_loss(
        self,
        original_entries: list[MemoryEntry],
        synthesized_entry: MemoryEntry,
    ) -> float:
        """Compute information loss from compression.
        
        Args:
            original_entries: Original entries before compression
            synthesized_entry: Synthesized entry after compression
        
        Returns:
            Information loss (0-1, higher = more loss)
        """
        if not original_entries:
            return 0.0
        
        # Convert embeddings to tensors
        original_embs = [
            torch.tensor(entry.embedding, dtype=torch.float32, device=self.device)
            for entry in original_entries
        ]
        synthesized_emb = torch.tensor(
            synthesized_entry.embedding,
            dtype=torch.float32,
            device=self.device
        )
        
        # Compute average distance from original to synthesized
        distances = []
        for orig_emb in original_embs:
            # L2 distance
            dist = torch.norm(orig_emb - synthesized_emb).item()
            distances.append(dist)
        
        # Normalize by average norm of original embeddings
        avg_norm = sum(torch.norm(emb).item() for emb in original_embs) / len(original_embs)
        if avg_norm > 0:
            avg_distance = sum(distances) / len(distances)
            normalized_loss = avg_distance / avg_norm
        else:
            normalized_loss = 0.0
        
        return min(normalized_loss, 1.0)  # Clamp to [0, 1]
    
    def compute_compression_ratio(
        self,
        original_count: int,
        synthesized_count: int,
    ) -> float:
        """Compute compression ratio.
        
        Args:
            original_count: Number of original entries
            synthesized_count: Number of synthesized entries
        
        Returns:
            Compression ratio (0-1, higher = better compression)
        """
        if original_count == 0:
            return 0.0
        
        ratio = synthesized_count / original_count
        return min(ratio, 1.0)  # Clamp to [0, 1]
    
    def compute_reconstruction_error(
        self,
        original: torch.Tensor | list[float],
        reconstructed: torch.Tensor | list[float],
    ) -> float:
        """Compute reconstruction error.
        
        Args:
            original: Original embedding
            reconstructed: Reconstructed embedding
        
        Returns:
            Reconstruction error (L2 distance)
        """
        if isinstance(original, list):
            original = torch.tensor(original, dtype=torch.float32, device=self.device)
        if isinstance(reconstructed, list):
            reconstructed = torch.tensor(reconstructed, dtype=torch.float32, device=self.device)
        
        original = original.to(device=self.device)
        reconstructed = reconstructed.to(device=self.device)
        
        error = torch.norm(original - reconstructed).item()
        return error
    
    def compute_semantic_similarity(
        self,
        entry_a: MemoryEntry,
        entry_b: MemoryEntry,
    ) -> float:
        """Compute semantic similarity (cosine similarity).
        
        Args:
            entry_a: First entry
            entry_b: Second entry
        
        Returns:
            Cosine similarity (-1 to 1)
        """
        emb_a = torch.tensor(entry_a.embedding, dtype=torch.float32, device=self.device)
        emb_b = torch.tensor(entry_b.embedding, dtype=torch.float32, device=self.device)
        
        dot_product = torch.dot(emb_a, emb_b)
        norm_a = torch.norm(emb_a)
        norm_b = torch.norm(emb_b)
        
        if norm_a > 0 and norm_b > 0:
            similarity = (dot_product / (norm_a * norm_b)).item()
            return similarity
        return 0.0
    
    def check_quality_bounds(
        self,
        original_entries: list[MemoryEntry],
        synthesized_entry: MemoryEntry,
        original_count: int,
        synthesized_count: int,
    ) -> tuple[bool, dict]:
        """Check if compression meets quality bounds.
        
        Args:
            original_entries: Original entries
            synthesized_entry: Synthesized entry
            original_count: Original count
            synthesized_count: Synthesized count
        
        Returns:
            (meets_bounds, metrics_dict)
        """
        info_loss = self.compute_information_loss(original_entries, synthesized_entry)
        comp_ratio = self.compute_compression_ratio(original_count, synthesized_count)
        
        meets_loss = info_loss <= self.max_information_loss
        meets_ratio = comp_ratio >= self.min_compression_ratio
        
        metrics = {
            "information_loss": info_loss,
            "compression_ratio": comp_ratio,
            "meets_loss_bound": meets_loss,
            "meets_ratio_bound": meets_ratio,
        }
        
        meets_bounds = meets_loss and meets_ratio
        
        return meets_bounds, metrics
