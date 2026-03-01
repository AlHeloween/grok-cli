"""Temporal dataset for temporal dynamics validation."""

from __future__ import annotations

from typing import Optional
import torch
from torch.utils.data import Dataset


class TemporalDataset(Dataset):
    """Dataset for temporal dynamics validation.
    
    Contains sequences with timestamps:
    - Input sequences with time steps
    - Target sequences (future states)
    - Timestamps for each step
    """
    
    def __init__(
        self,
        sequences: list[torch.Tensor],
        timestamps: list[torch.Tensor],
        targets: Optional[list[torch.Tensor]] = None,
    ):
        """Initialize temporal dataset.
        
        Args:
            sequences: List of input sequences [seq_len, dim]
            timestamps: List of timestamp tensors [seq_len]
            targets: Optional target sequences [seq_len, dim] (future states)
        """
        self.sequences = sequences
        self.timestamps = timestamps
        self.targets = targets if targets is not None else []
        
        if len(self.sequences) != len(self.timestamps):
            raise ValueError(f"sequences and timestamps must have same length, got {len(self.sequences)} and {len(self.timestamps)}")
        
        if self.targets and len(self.targets) != len(self.sequences):
            raise ValueError(f"targets must have same length as sequences, got {len(self.targets)} and {len(self.sequences)}")
    
    def __len__(self) -> int:
        return len(self.sequences)
    
    def __getitem__(self, idx: int) -> dict:
        """Get item from dataset.
        
        Args:
            idx: Index
        
        Returns:
            Dictionary with 'sequence', 'timestamps', and optionally 'target'
        """
        item = {
            'sequence': self.sequences[idx],
            'timestamps': self.timestamps[idx],
        }
        
        if self.targets:
            item['target'] = self.targets[idx]
        
        return item


def generate_synthetic_temporal_data(
    n_sequences: int,
    seq_len: int,
    dim: int,
    device: str = "cpu",
) -> TemporalDataset:
    """Generate synthetic temporal data for testing.
    
    Args:
        n_sequences: Number of sequences
        seq_len: Sequence length
        dim: Dimension of each time step
        device: Device for tensors
    
    Returns:
        TemporalDataset
    """
    sequences = []
    timestamps = []
    targets = []
    
    for i in range(n_sequences):
        # Generate sequence with temporal evolution
        sequence = torch.randn(seq_len, dim, device=device)
        
        # Generate timestamps (linear progression)
        ts = torch.linspace(0.0, 1.0, seq_len, device=device)
        
        # Generate target (future state - simplified: add noise)
        target = sequence + 0.1 * torch.randn(seq_len, dim, device=device)
        
        sequences.append(sequence)
        timestamps.append(ts)
        targets.append(target)
    
    return TemporalDataset(sequences, timestamps, targets)
