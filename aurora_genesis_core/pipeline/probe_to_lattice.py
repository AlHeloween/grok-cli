"""Probe → FFE → Lattice pipeline.

Complete pipeline: Input → Probe → FFE → Lattice addresses.
"""

from __future__ import annotations

from typing import Optional

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore

from aurora_genesis_core.memory.ffe_quantization import FFEQuantizer, FFEAddress
from aurora_genesis_core.memory.lattice_addressing import SierpinskiLatticeAddress
from aurora_genesis_core.memory.lattice_storage import LatticeMemoryStorage, MemoryEntry
from aurora_genesis_core.probe.probe_encoder import ProbeEncoder


if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.pipeline.probe_to_lattice requires torch. "
        "Install project dependencies so `torch` is available."
    )


def probe_to_lattice_pipeline(
    input_ids: torch.Tensor,  # [batch, seq] or [seq]
    probe_encoder: ProbeEncoder,
    ffe_quantizer: FFEQuantizer,
    lattice_storage: LatticeMemoryStorage,
    text: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> list[SierpinskiLatticeAddress]:
    """Complete pipeline: Input → Probe → FFE → Lattice addresses.
    
    Args:
        input_ids: Input token IDs [batch, seq] or [seq]
        probe_encoder: Probe encoder instance
        ffe_quantizer: FFE quantizer instance
        lattice_storage: Lattice storage instance
        text: Optional text associated with input
        metadata: Optional metadata
    
    Returns:
        List of lattice addresses where entries were stored
    """
    # 1. Encode with Probe
    # Probe encoder expects token IDs [batch, seq] and handles embedding internally
    if input_ids.dim() == 1:
        input_ids = input_ids.unsqueeze(0)  # [1, seq]
    
    # Ensure integer tensor for embedding lookup
    if input_ids.dtype != torch.long and input_ids.dtype != torch.int:
        # Convert float tensor to integer indices (e.g., discretize or use as indices)
        input_ids = input_ids.long() % probe_encoder.vocab_size
    
    # Encode with Probe (handles embedding internally)
    with torch.no_grad():
        dq_latents = probe_encoder(input_ids)  # DualQuaternionTensor [batch, seq, hidden_size, 8]
    
    # Extract underlying tensor and flatten for quantization
    dq_data = dq_latents.data  # [batch, seq, hidden_size, 8]
    batch_size, seq_len, hidden_size, dq_dim = dq_data.shape
    
    # Flatten: take mean across hidden dimension to get [batch, seq, 8]
    # This reduces [batch, seq, hidden_size, 8] -> [batch, seq, 8]
    dq_mean = dq_data.mean(dim=2)  # [batch, seq, 8]
    
    # Move to CPU for FFE quantization (quantizer centroids are on CPU)
    # Use detach() and clone() to ensure clean CPU tensor
    dq_mean = dq_mean.detach().cpu().clone()
    
    # Flatten for processing: [batch*seq, 8]
    dq_flat = dq_mean.view(batch_size * seq_len, dq_dim).contiguous()
    
    # 2. Quantize to FFE addresses
    addresses_bits = ffe_quantizer.quantize(dq_flat)  # [batch*seq]
    
    # Convert to addresses
    addresses = []
    if isinstance(addresses_bits, torch.Tensor):
        if addresses_bits.dim() == 0:
            addresses_bits = addresses_bits.unsqueeze(0)
        for addr_bits in addresses_bits:
            ffe_addr = FFEAddress.from_bits(addr_bits.item())
            lattice_addr = SierpinskiLatticeAddress.from_ffe_address(ffe_addr)
            addresses.append(lattice_addr)
    else:
        # Scalar
        ffe_addr = FFEAddress.from_bits(addresses_bits)
        lattice_addr = SierpinskiLatticeAddress.from_ffe_address(ffe_addr)
        addresses.append(lattice_addr)
    
    # 3. Write to lattice storage
    stored_addresses = []
    for i, address in enumerate(addresses):
        # Get corresponding dual quaternion
        dq = dq_flat[i]  # [8]
        
        # Create memory entry
        entry = MemoryEntry(
            embedding=dq.tolist(),
            text=text,
            metadata={
                **(metadata or {}),
                'batch_idx': i // seq_len,
                'seq_idx': i % seq_len,
            },
        )
        
        # Write to storage
        if lattice_storage.write_leaf(address, entry):
            stored_addresses.append(address)
    
    return stored_addresses


def probe_to_lattice_batch(
    input_batch: list[torch.Tensor],  # List of [seq] tensors
    probe_encoder: ProbeEncoder,
    ffe_quantizer: FFEQuantizer,
    lattice_storage: LatticeMemoryStorage,
    texts: Optional[list[str]] = None,
    metadata_list: Optional[list[dict]] = None,
) -> list[list[SierpinskiLatticeAddress]]:
    """Batch version of probe_to_lattice_pipeline.
    
    Args:
        input_batch: List of input tensors
        probe_encoder: Probe encoder instance
        ffe_quantizer: FFE quantizer instance
        lattice_storage: Lattice storage instance
        texts: Optional list of texts
        metadata_list: Optional list of metadata dicts
    
    Returns:
        List of address lists (one per input)
    """
    results = []
    
    for i, input_ids in enumerate(input_batch):
        text = texts[i] if texts and i < len(texts) else None
        metadata = metadata_list[i] if metadata_list and i < len(metadata_list) else None
        
        addresses = probe_to_lattice_pipeline(
            input_ids=input_ids,
            probe_encoder=probe_encoder,
            ffe_quantizer=ffe_quantizer,
            lattice_storage=lattice_storage,
            text=text,
            metadata=metadata,
        )
        results.append(addresses)
    
    return results
