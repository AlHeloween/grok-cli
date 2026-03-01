"""Triplet synthesis operator: (A, B, C) → higher-order node."""

from __future__ import annotations

from typing import Optional
import torch
import torch.nn as nn

from aurora_genesis_core.memory.lattice_storage import MemoryEntry


class TripletOperator(nn.Module):
    """Triplet synthesis: (A, B, C) → higher-order node.
    
    Takes three memory entries and synthesizes a compressed
    representation that captures their combined information.
    """
    
    def __init__(
        self,
        input_dim: int = 8,  # Dual quaternion dimension
        output_dim: Optional[int] = None,
        method: str = "mean",  # "mean", "max", "dual_quaternion", "learned"
        device: str = "cpu",
    ):
        super().__init__()
        
        self.input_dim = int(input_dim)
        self.output_dim = int(output_dim) if output_dim is not None else int(input_dim)
        self.method = str(method)
        self.device = device
        
        # Learned aggregation network (optional)
        if method == "learned":
            self.aggregation_net = nn.Sequential(
                nn.Linear(self.input_dim * 3, self.input_dim * 2),
                nn.ReLU(),
                nn.Linear(self.input_dim * 2, self.output_dim),
            ).to(device=device)
        else:
            self.aggregation_net = None
    
    def forward(
        self,
        entry_a: MemoryEntry,
        entry_b: MemoryEntry,
        entry_c: MemoryEntry,
    ) -> MemoryEntry:
        """Synthesize higher-order node from triplet.
        
        Args:
            entry_a: First memory entry
            entry_b: Second memory entry
            entry_c: Third memory entry
        
        Returns:
            Synthesized memory entry
        """
        # Extract embeddings
        emb_a = entry_a.embedding
        emb_b = entry_b.embedding
        emb_c = entry_c.embedding
        
        # Ensure tensors
        if not isinstance(emb_a, torch.Tensor):
            emb_a = torch.tensor(emb_a, dtype=torch.float32, device=self.device)
        if not isinstance(emb_b, torch.Tensor):
            emb_b = torch.tensor(emb_b, dtype=torch.float32, device=self.device)
        if not isinstance(emb_c, torch.Tensor):
            emb_c = torch.tensor(emb_c, dtype=torch.float32, device=self.device)
        
        # Ensure correct device
        emb_a = emb_a.to(device=self.device)
        emb_b = emb_b.to(device=self.device)
        emb_c = emb_c.to(device=self.device)
        
        # Synthesize embedding based on method
        if self.method == "mean":
            synthesized_emb = (emb_a + emb_b + emb_c) / 3.0
        elif self.method == "max":
            stacked = torch.stack([emb_a, emb_b, emb_c], dim=0)
            synthesized_emb = torch.max(stacked, dim=0)[0]
        elif self.method == "dual_quaternion":
            # Hamilton product-based synthesis
            # For dual quaternions, we use geometric mean via Hamilton product
            # Simplified: average in dual quaternion space
            synthesized_emb = (emb_a + emb_b + emb_c) / 3.0
            # Normalize if needed (for quaternions)
            norm = torch.norm(synthesized_emb)
            if norm > 0:
                synthesized_emb = synthesized_emb / norm
        elif self.method == "learned":
            if self.aggregation_net is None:
                raise ValueError("Learned method requires aggregation_net")
            # Concatenate embeddings
            concat = torch.cat([emb_a, emb_b, emb_c], dim=0)
            synthesized_emb = self.aggregation_net(concat)
        else:
            raise ValueError(f"Unknown synthesis method: {self.method}")
        
        # Combine text (concatenate or select representative)
        combined_text = self._combine_texts(
            entry_a.text,
            entry_b.text,
            entry_c.text,
        )
        
        # Combine metadata
        combined_metadata = {
            "synthesized": True,
            "method": self.method,
            "source_entries": [
                entry_a.text[:50] if entry_a.text else "None",
                entry_b.text[:50] if entry_b.text else "None",
                entry_c.text[:50] if entry_c.text else "None",
            ],
        }
        
        # Merge with existing metadata
        for entry in [entry_a, entry_b, entry_c]:
            if entry.metadata:
                combined_metadata.update(entry.metadata)
        
        # Convert embedding to list if tensor
        if isinstance(synthesized_emb, torch.Tensor):
            synthesized_emb_list = synthesized_emb.cpu().numpy().tolist()
        else:
            synthesized_emb_list = synthesized_emb
        
        # Create synthesized entry
        synthesized_entry = MemoryEntry(
            embedding=synthesized_emb_list,
            text=combined_text,
            metadata=combined_metadata,
        )
        
        return synthesized_entry
    
    def _combine_texts(
        self,
        text_a: str,
        text_b: str,
        text_c: str,
    ) -> str:
        """Combine texts from three entries.
        
        Strategy: Concatenate with separator, or select representative.
        """
        texts = [t for t in [text_a, text_b, text_c] if t]
        if not texts:
            return ""
        
        # Simple concatenation with separator
        return " | ".join(texts[:3])  # Limit to 3 texts


def synthesize_triplet(
    entry_a: MemoryEntry,
    entry_b: MemoryEntry,
    entry_c: MemoryEntry,
    method: str = "mean",
    device: str = "cpu",
) -> MemoryEntry:
    """Convenience function for triplet synthesis.
    
    Args:
        entry_a: First memory entry
        entry_b: Second memory entry
        entry_c: Third memory entry
        method: Synthesis method ("mean", "max", "dual_quaternion", "learned")
        device: Device for computation
    
    Returns:
        Synthesized memory entry
    """
    operator = TripletOperator(method=method, device=device)
    return operator(entry_a, entry_b, entry_c)
