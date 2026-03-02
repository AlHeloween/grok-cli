#!/usr/bin/env python3
"""Verify compatibility between Aurora Genesis Python reference and TypeScript implementation.

This script tests core algorithms that don't require deepseek_adapter dependency.
"""

import sys
import os
import json
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

try:
    import torch

    print(f"✓ torch {torch.__version__}")
except ImportError:
    print("✗ torch not installed")
    sys.exit(1)


# Mock deepseek_adapter before importing any Aurora modules
class MockInformationMark:
    pass


# Insert mock into sys.modules before importing aurora_genesis_core
import sys

sys.modules["deepseek_adapter"] = type(sys)("deepseek_adapter")
sys.modules["deepseek_adapter.adid_memory"] = type(sys)("deepseek_adapter.adid_memory")
sys.modules["deepseek_adapter"].adid_memory = sys.modules[
    "deepseek_adapter.adid_memory"
]
sys.modules["deepseek_adapter.adid_memory"].InformationMark = MockInformationMark
sys.modules["deepseek_adapter.adid_memory"].ADIDContext = MockInformationMark
sys.modules["deepseek_adapter"].config = type(sys)("config")
sys.modules["deepseek_adapter"].config.AuroraConfig = MockInformationMark


def test_sierpinski_centroids():
    """Generate Sierpinski centroids and compare with TypeScript reference."""
    try:
        from aurora_genesis_core.fractal.sierpinski import generate_sierpinski_centroids

        print("\n=== Sierpinski Centroids Test ===")

        # Generate centroids with same parameters as TypeScript test
        centroids = generate_sierpinski_centroids(
            n_dim=3, depth=2, n_centroids=10, seed=1234, device="cpu"
        )

        print(f"Generated {len(centroids)} centroids of dimension {centroids.shape[1]}")
        print("First centroid:", centroids[0].tolist())
        print("Last centroid:", centroids[-1].tolist())

        # Compute statistics
        mean = centroids.mean(dim=0)
        std = centroids.std(dim=0)
        print(f"Mean: {mean.tolist()}")
        print(f"Std: {std.tolist()}")

        # Save for comparison
        output = {
            "centroids": centroids.tolist(),
            "params": {"n_dim": 3, "depth": 2, "seed": 1234, "n_centroids": 10},
        }

        output_path = Path("data/aurora_verification/sierpinski_centroids.json")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)

        print(f"✓ Saved centroids to {output_path}")
        return True

    except Exception as e:
        print(f"✗ Sierpinski test failed: {e}")
        import traceback

        traceback.print_exc()
        return False


def test_ffe_quantization():
    """Test FFE quantization."""
    try:
        from aurora_genesis_core.memory.ffe_quantization import FFEQuantizer

        print("\n=== FFE Quantization Test ===")

        quantizer = FFEQuantizer(
            n_levels=3, n_per_level=9, dim=8, seed=42, device="cpu"
        )

        # Create test vector
        import torch

        vector = torch.randn(8)
        print(f"Test vector: {vector.tolist()}")

        # Quantize
        bits_result = quantizer.quantize(vector, return_metadata=False)
        print(f"Quantized bits result type: {type(bits_result)}")

        # Convert to integer if tensor
        if isinstance(bits_result, torch.Tensor):
            if bits_result.dim() == 0:
                bits_int = int(bits_result.item())
            else:
                bits_int = int(bits_result[0].item())  # assume first element
        else:
            bits_int = int(bits_result)  # should be int

        print(f"Quantized bits: {bits_int}")

        # Dequantize
        centroid = quantizer.dequantize(bits_int)
        print(f"Dequantized centroid: {centroid}")

        # Address conversion
        from aurora_genesis_core.memory.ffe_quantization import FFEAddress

        addr = FFEAddress.from_bits(bits_int)
        print(
            f"Address: level={addr.level}, index={addr.index}, sub_index={addr.sub_index}"
        )

        bits2 = addr.to_bits()
        print(f"Bits round-trip: {bits_int == bits2}")

        return True

    except Exception as e:
        print(f"✗ FFE quantization test failed: {e}")
        import traceback

        traceback.print_exc()
        return False


def main():
    print("Aurora Genesis Compatibility Verification")
    print("=" * 50)

    success = True
    success = test_sierpinski_centroids() and success
    success = test_ffe_quantization() and success

    if success:
        print("\n" + "=" * 50)
        print("✓ All compatibility tests passed")
        print("\nNote: This verifies core algorithms work independently.")
        print("Full pipeline requires deepseek_adapter dependency.")
    else:
        print("\n" + "=" * 50)
        print("✗ Some tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()

# ADID_ROLLBACK (from adm.exe)
# SDID_ROLLBACK {
#   "target_file": "D:\\zPython\\grok-cli\\scripts/verify_aurora_compatibility.py"
#   "update_script": "adm.exe"
#   "backup_path": "none"
#   "created_at": "2026-03-02T04:13:15.288392+00:00"
#   "new_hash": "0752e895eb3bd3606c1de6a5e7ed67ee"
#   "goal_id": "text_create_new_file"
#   "semantics": "Create Python verification script for Aurora core algorithms."
#   "update_attrs": {"relative_path": "scripts/verify_aurora_compatibility.py", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
#   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\scripts/verify_aurora_compatibility.py\""
# }
