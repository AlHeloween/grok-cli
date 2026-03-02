"""Complete example of Aurora Genesis full pipeline."""

from __future__ import annotations

import sys
from pathlib import Path

import torch

# Add project root to path
project_root = Path(__file__).parent.parent.parent
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

# ADID_ROLLBACK (from adm.exe)
# SDID_ROLLBACK {
#   "target_file": "D:\\zPython\\grok-cli\\aurora_genesis_core/examples/full_aurora_example.py"
#   "update_script": "adm.exe"
#   "backup_path": "D:\\zPython\\grok-cli\\aurora_genesis_core/examples/full_aurora_example.py.backup_20260302T111414_170865"
#   "created_at": "2026-03-02T03:14:14.180491+00:00"
#   "backup_hash": "de38165cb3fe0f592ae73307535c4b93"
#   "new_hash": "535bddf13be68bb97c74a5feaedd1f3b"
#   "goal_id": "text_anchor_replace"
#   "semantics": "Fix sys.path to include project root instead of aurora_genesis_core directory."
#   "update_attrs": {"relative_path": "aurora_genesis_core/examples/full_aurora_example.py", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "project_root = Path(__file__).parent.parent", "replace_present": true}
#   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\aurora_genesis_core/examples/full_aurora_example.py\""
# }
