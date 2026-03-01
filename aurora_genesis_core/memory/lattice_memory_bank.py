"""Lattice memory bank using Sierpinski lattice addressing.

Replaces or extends TextFractalMemoryBank with FFE quantization and lattice addressing.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore

from aurora_genesis_core.fractal.sierpinski import generate_sierpinski_centroids
from aurora_genesis_core.memory.ffe_quantization import FFEQuantizer
from aurora_genesis_core.memory.lattice_addressing import LatticeAddressing, SierpinskiLatticeAddress
from aurora_genesis_core.memory.lattice_retrieval import LatticeRetrieval
from aurora_genesis_core.memory.lattice_storage import LatticeMemoryStorage, MemoryEntry


if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.memory.lattice_memory_bank requires torch. "
        "Install project dependencies so `torch` is available."
    )


class LatticeMemoryBank:
    """Memory bank using Sierpinski lattice addressing.
    
    Replaces or extends TextFractalMemoryBank with:
    - FFE quantization
    - Lattice addressing
    - Persistent storage
    """
    
    def __init__(
        self,
        n_levels: int = 8,
        n_per_level: int = 512,
        dim: int = 8,  # Dual quaternion dimension
        seed: int = 1234,
        storage_path: Optional[Path | str] = None,
        device: Optional[str] = None,
    ):
        """Initialize lattice memory bank.
        
        Args:
            n_levels: Number of hierarchical levels
            n_per_level: Number of centroids per level
            dim: Dimension of dual quaternion
            seed: Random seed
            storage_path: Path to storage file
            device: PyTorch device
        """
        self.n_levels = n_levels
        self.n_per_level = n_per_level
        self.dim = dim
        self.seed = seed
        
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device
        
        # Initialize components
        self.quantizer = FFEQuantizer(
            n_levels=n_levels,
            n_per_level=n_per_level,
            dim=dim,
            seed=seed,
            device=device,
        )
        
        self.addressing = LatticeAddressing(
            n_levels=n_levels,
            n_per_level=n_per_level,
            dim=dim,
            seed=seed,
            device=device,
        )
        
        self.storage = LatticeMemoryStorage(
            storage_path=storage_path,
            n_levels=n_levels,
            n_per_level=n_per_level,
        )
        
        self.retrieval = LatticeRetrieval(
            storage=self.storage,
            addressing=self.addressing,
        )
    
    def add(
        self,
        embedding: list[float] | torch.Tensor,  # [8] or [dim]
        text: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> SierpinskiLatticeAddress:
        """Add entry to memory bank.
        
        Args:
            embedding: Dual quaternion embedding [8]
            text: Optional text
            metadata: Optional metadata
        
        Returns:
            Address where entry was stored
        """
        # Convert to tensor if needed
        if isinstance(embedding, list):
            embedding_tensor = torch.tensor(embedding, device=self.device, dtype=torch.float32)
        else:
            embedding_tensor = embedding.to(device=self.device)
        
        # Ensure correct shape [8]
        if embedding_tensor.dim() > 1:
            embedding_tensor = embedding_tensor.flatten()
        if embedding_tensor.shape[0] != self.dim:
            raise ValueError(f"Embedding dimension must be {self.dim}, got {embedding_tensor.shape[0]}")
        
        # Quantize to address
        addresses_bits = self.quantizer.quantize(embedding_tensor)  # Scalar or [1]
        
        # Convert to address
        if isinstance(addresses_bits, torch.Tensor):
            if addresses_bits.dim() > 0:
                addr_bits = addresses_bits[0].item()
            else:
                addr_bits = addresses_bits.item()
        else:
            addr_bits = addresses_bits
        
        from aurora_genesis_core.memory.ffe_quantization import FFEAddress
        ffe_addr = FFEAddress.from_bits(addr_bits)
        lattice_addr = SierpinskiLatticeAddress.from_ffe_address(ffe_addr)
        
        # Create entry
        entry = MemoryEntry(
            embedding=embedding_tensor.tolist(),
            text=text,
            metadata=metadata,
        )
        
        # Store
        self.storage.write_leaf(lattice_addr, entry)
        
        return lattice_addr
    
    def query(
        self,
        query_embedding: list[float] | torch.Tensor,  # [8] or [dim]
        k: int = 8,
        candidate_slots: int = 4,
    ) -> list[MemoryEntry]:
        """Query memory bank.
        
        Args:
            query_embedding: Query dual quaternion embedding [8]
            k: Number of entries to retrieve
            candidate_slots: Number of candidate slots
        
        Returns:
            List of memory entries
        """
        # Convert to tensor if needed
        if isinstance(query_embedding, list):
            query_tensor = torch.tensor(query_embedding, device=self.device, dtype=torch.float32)
        else:
            query_tensor = query_embedding.to(device=self.device)
        
        # Ensure correct shape [8]
        if query_tensor.dim() > 1:
            query_tensor = query_tensor.flatten()
        if query_tensor.shape[0] != self.dim:
            raise ValueError(f"Query embedding dimension must be {self.dim}, got {query_tensor.shape[0]}")
        
        # Quantize to address
        addresses_bits = self.quantizer.quantize(query_tensor)
        
        # Convert to address
        if isinstance(addresses_bits, torch.Tensor):
            if addresses_bits.dim() > 0:
                addr_bits = addresses_bits[0].item()
            else:
                addr_bits = addresses_bits.item()
        else:
            addr_bits = addresses_bits
        
        from aurora_genesis_core.memory.ffe_quantization import FFEAddress
        ffe_addr = FFEAddress.from_bits(addr_bits)
        query_address = SierpinskiLatticeAddress.from_ffe_address(ffe_addr)
        
        # Retrieve
        return self.retrieval.retrieve_by_address(query_address, k, candidate_slots)
    
    def save(self, path: Optional[Path | str] = None) -> bool:
        """Save memory bank to file.
        
        Args:
            path: Optional path (uses storage_path if None)
        
        Returns:
            True if successful
        """
        return self.storage.save(path)
    
    def load(self, path: Optional[Path | str] = None) -> bool:
        """Load memory bank from file.
        
        Args:
            path: Optional path (uses storage_path if None)
        
        Returns:
            True if successful
        """
        return self.storage.load(path)
    
    def get_stats(self) -> dict:
        """Get memory bank statistics.
        
        Returns:
            Dictionary with statistics
        """
        return self.storage.get_stats()
    
    def clear(self) -> None:
        """Clear all entries."""
        self.storage.clear()
    
    def promote_entries(
        self,
        level: int,
        promotion_system,  # PromotionSystem (avoid circular import)
    ) -> int:
        """Promote entries from level to level+1.
        
        Args:
            level: Source level
            promotion_system: PromotionSystem instance
        
        Returns:
            Number of entries promoted
        """
        return promotion_system.promote_level(self, level, level + 1)
    
    def update_hierarchy(
        self,
        promotion_system,  # PromotionSystem (avoid circular import)
    ) -> dict[int, int]:
        """Update entire hierarchy using promotion system.
        
        Args:
            promotion_system: PromotionSystem instance
        
        Returns:
            Dictionary mapping level -> number of promotions
        """
        return promotion_system.update_hierarchy(self)
