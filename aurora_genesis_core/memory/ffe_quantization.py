"""FFE (Fractal Feature Encoding) 3-9-2 quantization.

FFE format: 3 bits for level, 9 bits for index, 2 bits for sub-index
Total: 14 bits per address

Structure:
- Level (3 bits): Hierarchical level in Sierpinski lattice (0-7)
- Index (9 bits): Index within level (0-511)
- Sub-index (2 bits): Sub-position within cell (0-3)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

try:
    import torch
    import torch.nn as nn
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore
    nn = None  # type: ignore

from aurora_genesis_core.fractal.sierpinski import generate_sierpinski_centroids


if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.memory.ffe_quantization requires torch. "
        "Install project dependencies so `torch` is available."
    )


@dataclass
class FFEAddress:
    """FFE address structure (3-9-2 format)."""
    level: int      # 0-7 (3 bits)
    index: int      # 0-511 (9 bits)
    sub_index: int  # 0-3 (2 bits)
    
    def to_bits(self) -> int:
        """Encode address as 14-bit integer."""
        return (self.level << 11) | (self.index << 2) | self.sub_index
    
    @classmethod
    def from_bits(cls, bits: int) -> FFEAddress:
        """Decode 14-bit integer to address."""
        level = (bits >> 11) & 0x7
        index = (bits >> 2) & 0x1FF
        sub_index = bits & 0x3
        return cls(level=level, index=index, sub_index=sub_index)
    
    def __repr__(self) -> str:
        return f"FFEAddress(level={self.level}, index={self.index}, sub_index={self.sub_index})"


@dataclass
class QuantizationMetadata:
    """Metadata for reversible quantization."""
    exact_position: torch.Tensor  # Original dual quaternion [8]
    quantization_error: float   # L2 distance to quantized position
    address: FFEAddress          # Quantized address


class FFEQuantizer:
    """FFE (Fractal Feature Encoding) 3-9-2 quantization.
    
    Converts continuous dual quaternion latents to discrete FFE addresses
    using Sierpinski lattice centroids.
    """
    
    def __init__(
        self,
        n_levels: int = 8,
        n_per_level: int = 512,
        dim: int = 8,  # Dual quaternion dimension
        seed: int = 1234,
        device: Optional[str] = None,
    ):
        """Initialize FFE quantizer.
        
        Args:
            n_levels: Number of hierarchical levels (0-7, 3 bits)
            n_per_level: Number of centroids per level (0-511, 9 bits)
            dim: Dimension of dual quaternion (default: 8)
            seed: Random seed for deterministic centroid generation
            device: PyTorch device
        """
        if n_levels > 8:
            raise ValueError(f"n_levels must be <= 8 (3 bits), got {n_levels}")
        if n_per_level > 512:
            raise ValueError(f"n_per_level must be <= 512 (9 bits), got {n_per_level}")
        
        self.n_levels = n_levels
        self.n_per_level = n_per_level
        self.dim = dim
        self.seed = seed
        
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device
        
        # Generate Sierpinski centroids for all levels
        # Shape: [n_levels, n_per_level, dim]
        self.centroids = self._generate_centroids()
    
    def _generate_centroids(self) -> torch.Tensor:
        """Generate Sierpinski centroids for all levels."""
        all_centroids = []
        
        for level in range(self.n_levels):
            # Generate centroids for this level
            # Depth increases with level (finer granularity at higher levels)
            depth = level + 1
            centroids = generate_sierpinski_centroids(
                n_dim=self.dim,
                depth=depth,
                n_centroids=self.n_per_level,
                seed=self.seed + level,  # Different seed per level
                device=self.device,
            )
            # Ensure correct shape: [n_per_level, dim]
            if centroids.shape[0] > self.n_per_level:
                centroids = centroids[:self.n_per_level]
            elif centroids.shape[0] < self.n_per_level:
                # Pad with zeros if needed
                padding = torch.zeros(
                    self.n_per_level - centroids.shape[0],
                    self.dim,
                    device=self.device,
                )
                centroids = torch.cat([centroids, padding], dim=0)
            
            all_centroids.append(centroids)
        
        # Stack: [n_levels, n_per_level, dim]
        return torch.stack(all_centroids, dim=0)
    
    def quantize(
        self,
        dual_quaternion: torch.Tensor,  # [batch, seq, 8] or [8]
        return_metadata: bool = False,
    ) -> torch.Tensor | tuple[torch.Tensor, list[QuantizationMetadata]]:
        """Quantize dual quaternion to FFE address.
        
        Args:
            dual_quaternion: Dual quaternion tensor [batch, seq, 8] or [8]
            return_metadata: If True, return quantization metadata
        
        Returns:
            addresses: Bit-packed addresses [batch, seq] or scalar (14-bit integers)
            metadata: (optional) List of QuantizationMetadata
        """
        # Handle different input shapes
        if dual_quaternion.dim() == 1:
            # Single dual quaternion [8]
            dual_quaternion = dual_quaternion.unsqueeze(0).unsqueeze(0)  # [1, 1, 8]
            squeeze_output = True
        elif dual_quaternion.dim() == 2:
            # [seq, 8] -> [1, seq, 8]
            dual_quaternion = dual_quaternion.unsqueeze(0)
            squeeze_output = False
        else:
            # [batch, seq, 8]
            squeeze_output = False
        
        batch_size, seq_len, _ = dual_quaternion.shape
        
        # Find nearest centroid for each dual quaternion
        addresses = []
        metadata_list = []
        
        for b in range(batch_size):
            batch_addresses = []
            for s in range(seq_len):
                dq = dual_quaternion[b, s]  # [8]
                
                # Find nearest centroid across all levels
                best_level = 0
                best_index = 0
                best_sub_index = 0
                best_distance = float('inf')
                best_centroid = None
                
                for level in range(self.n_levels):
                    level_centroids = self.centroids[level]  # [n_per_level, dim]
                    
                    # Compute distances to all centroids in this level
                    distances = torch.norm(
                        level_centroids - dq.unsqueeze(0),
                        dim=1,
                    )  # [n_per_level]
                    
                    # Find nearest centroid
                    min_dist, min_idx = torch.min(distances, dim=0)
                    min_dist = min_dist.item()
                    min_idx = min_idx.item()
                    
                    # For sub-index, we can subdivide the cell into 4 regions
                    # For now, use 0 (can be enhanced later)
                    sub_idx = 0
                    
                    if min_dist < best_distance:
                        best_distance = min_dist
                        best_level = level
                        best_index = min_idx
                        best_sub_index = sub_idx
                        best_centroid = level_centroids[min_idx]
                
                # Create address
                address = FFEAddress(
                    level=best_level,
                    index=best_index,
                    sub_index=best_sub_index,
                )
                address_bits = address.to_bits()
                batch_addresses.append(address_bits)
                
                if return_metadata:
                    # Store metadata
                    metadata = QuantizationMetadata(
                        exact_position=dq.clone(),
                        quantization_error=best_distance,
                        address=address,
                    )
                    metadata_list.append(metadata)
            
            addresses.append(batch_addresses)
        
        # Convert to tensor
        addresses_tensor = torch.tensor(
            addresses,
            dtype=torch.int32,
            device=self.device,
        )  # [batch, seq]
        
        if squeeze_output:
            addresses_tensor = addresses_tensor.squeeze(0).squeeze(0)
            if addresses_tensor.dim() == 0:
                addresses_tensor = addresses_tensor.item()
        
        if return_metadata:
            return addresses_tensor, metadata_list
        return addresses_tensor
    
    def dequantize(
        self,
        addresses: torch.Tensor | int,  # [batch, seq] or scalar (14-bit integers)
        metadata: Optional[list[QuantizationMetadata]] = None,
    ) -> torch.Tensor:
        """Dequantize FFE addresses back to dual quaternions.
        
        Args:
            addresses: Bit-packed addresses [batch, seq] or scalar
            metadata: Optional metadata for exact reconstruction
        
        Returns:
            dual_quaternions: Approximate dual quaternions [batch, seq, 8]
        """
        # Handle different input shapes
        if isinstance(addresses, int):
            addresses = torch.tensor([addresses], device=self.device)
        
        if addresses.dim() == 0:
            addresses = addresses.unsqueeze(0)
        
        if addresses.dim() == 1:
            addresses = addresses.unsqueeze(0)  # [1, seq]
        
        batch_size, seq_len = addresses.shape
        
        # Dequantize each address
        dual_quaternions = []
        
        for b in range(batch_size):
            batch_dqs = []
            for s in range(seq_len):
                addr_bits = addresses[b, s].item()
                address = FFEAddress.from_bits(addr_bits)
                
                # Get centroid for this address
                centroid = self.centroids[address.level, address.index]  # [dim]
                
                # If metadata available, use exact position
                if metadata is not None:
                    idx = b * seq_len + s
                    if idx < len(metadata) and metadata[idx] is not None:
                        dq = metadata[idx].exact_position
                    else:
                        dq = centroid
                else:
                    dq = centroid
                
                batch_dqs.append(dq)
            
            dual_quaternions.append(torch.stack(batch_dqs, dim=0))
        
        # Stack: [batch, seq, 8]
        result = torch.stack(dual_quaternions, dim=0)
        
        # Squeeze if input was scalar
        if result.shape[0] == 1 and result.shape[1] == 1:
            result = result.squeeze(0).squeeze(0)
        
        return result
    
    def get_centroid(self, address: FFEAddress) -> torch.Tensor:
        """Get centroid for a given address.
        
        Args:
            address: FFE address
        
        Returns:
            centroid: Centroid coordinates [dim]
        """
        return self.centroids[address.level, address.index].clone()
