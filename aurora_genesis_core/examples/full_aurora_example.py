"""Complete example of Aurora Genesis full pipeline."""

from __future__ import annotations

import sys
from pathlib import Path

import torch

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from aurora_genesis_core.pipeline.full_integration import create_full_pipeline


def main():
    """Run complete Aurora Genesis example."""
    print("="*80)
    print("AURORA GENESIS - COMPLETE EXAMPLE")
    print("="*80)
    
    # 1. Create pipeline
    print("\n[1] Creating Aurora pipeline...")
    pipeline = create_full_pipeline(
        vocab_size=1000,
        hidden_size=64,
        num_layers=2,
        num_heads=4,
        use_evolver=False,  # Set to True to enable temporal evolution
        device="cpu",
    )
    print("✓ Pipeline created")
    
    # 2. Process input
    print("\n[2] Processing input sequence...")
    input_ids = torch.randint(0, 1000, (1, 20))
    print(f"  Input shape: {input_ids.shape}")
    
    output = pipeline.forward(input_ids)
    print(f"  Output shape: {output['output'].shape}")
    print(f"  Addresses generated: {len(output['addresses'])}")
    print(f"  Memory entries retrieved: {len(output['memory_entries'])}")
    
    # 3. Process with temporal evolution
    print("\n[3] Processing with temporal evolution...")
    pipeline_with_evolver = create_full_pipeline(
        vocab_size=1000,
        hidden_size=64,
        num_layers=2,
        num_heads=4,
        use_evolver=True,
        device="cpu",
    )
    
    timestamps = torch.linspace(0.0, 1.0, 20)
    output_temporal = pipeline_with_evolver.forward(input_ids, timestamps=timestamps)
    print(f"  Temporal output shape: {output_temporal['output'].shape}")
    
    # 4. Memory bank statistics
    print("\n[4] Memory bank statistics...")
    stats = pipeline.memory_bank.get_stats()
    print(f"  Total entries: {stats['total_entries']}")
    print(f"  Total addresses: {stats['total_addresses']}")
    print(f"  Entries per level: {stats.get('level_counts', {})}")
    
    print("\n" + "="*80)
    print("EXAMPLE COMPLETE")
    print("="*80)


if __name__ == "__main__":
    main()
