'''Memory addressing: Sierpinski-based memory addressing and centroid assignment.'''

from __future__ import annotations

from typing import Optional, Union

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore

if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.pipeline.memory_addressing requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )

from aurora_genesis_core.fractal.sierpinski import generate_sierpinski_centroids
from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor


class MemoryAddressing:
    """
    Sierpinski-based memory addressing and centroid assignment.

    Initializes memory bank with Sierpinski fractal centroids and provides
    nearest-neighbor assignment of embeddings to centroids.

    Attributes:
        n_dim: Embedding dimension.
        n_clusters: Number of memory clusters (centroids).
        sierpinski_depth: Depth of Sierpinski chaos game iterations.
        sierpinski_seed: Seed for deterministic fractal generation.
        device: PyTorch device.
        memory_bank: Memory bank tensor (n_clusters, n_dim) or None if not initialized.
    """

    def __init__(
        self,
        n_dim: int,
        n_clusters: int,
        sierpinski_depth: int = 2,
        sierpinski_seed: int = 1234,
        device: Optional[str] = None,
    ):
        """
        Initialize memory addressing.

        Args:
            n_dim: Embedding dimension.
            n_clusters: Number of memory clusters (centroids).
            sierpinski_depth: Depth of Sierpinski chaos game iterations.
            sierpinski_seed: Seed for deterministic fractal generation.
            device: PyTorch device ('cuda', 'cpu', etc.). Defaults to 'cuda' if available.
        """
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"

        self.n_dim = n_dim
        self.n_clusters = n_clusters
        self.sierpinski_depth = sierpinski_depth
        self.sierpinski_seed = sierpinski_seed
        self.device = device
        self.memory_bank: Optional[torch.Tensor] = None

    def initialize(self) -> torch.Tensor:
        """
        Initialize memory bank with Sierpinski fractal centroids.

        Returns:
            Memory bank tensor (n_clusters, n_dim) on GPU.
        """
        # Generate Sierpinski centroids
        # Generate exactly n_clusters centroids (avoid generating huge banks then slicing).
        centroids = generate_sierpinski_centroids(
            n_dim=self.n_dim,
            depth=self.sierpinski_depth,
            n_centroids=self.n_clusters,
            seed=self.sierpinski_seed,
            device=self.device,
        )

        self.memory_bank = centroids
        return centroids

    def assign_to_centroids(
        self,
        embeddings: Union[torch.Tensor, DualComplexTensor],
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Assign embeddings to nearest memory centroids.

        Args:
            embeddings: Embeddings tensor (batch_size, seq_len, n_dim) or DualComplexTensor.
                If DualComplexTensor, uses primal component for assignment.

        Returns:
            Tuple of (assignments, distances):
            - assignments: Centroid indices (batch_size, seq_len) with int64 dtype.
            - distances: Distances to assigned centroids (batch_size, seq_len).
        """
        if self.memory_bank is None:
            raise RuntimeError("Memory bank not initialized. Call initialize() first.")

        # Extract primal component if DualComplexTensor
        if isinstance(embeddings, DualComplexTensor):
            embeddings_flat = embeddings.primal
        else:
            embeddings_flat = embeddings

        # Flatten batch and sequence dimensions
        batch_size, seq_len, n_dim = embeddings_flat.shape
        embeddings_2d = embeddings_flat.view(batch_size * seq_len, n_dim)  # (batch*seq, n_dim)

        # Compute distances to all centroids: (batch*seq, n_clusters)
        # memory_bank: (n_clusters, n_dim)
        # embeddings_2d: (batch*seq, n_dim)
        # distances[i, j] = ||embeddings_2d[i] - memory_bank[j]||^2
        distances = torch.cdist(embeddings_2d, self.memory_bank, p=2)  # (batch*seq, n_clusters)

        # Find nearest centroids
        assignments_flat = torch.argmin(distances, dim=1)  # (batch*seq,)
        distances_flat = distances[torch.arange(batch_size * seq_len, device=distances.device), assignments_flat]

        # Reshape back to (batch_size, seq_len)
        assignments = assignments_flat.view(batch_size, seq_len)
        distances_reshaped = distances_flat.view(batch_size, seq_len)

        return assignments, distances_reshaped
