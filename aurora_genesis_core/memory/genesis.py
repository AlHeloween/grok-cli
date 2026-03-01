'''Genesis memory: Sierpinski fractal initialization + SE(3) K-Medoids clustering.'''

from __future__ import annotations

from typing import Optional

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore

if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.memory.genesis requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )

from aurora_genesis_core.fractal.sierpinski import generate_sierpinski_centroids
from aurora_genesis_core.se3.kmedoids import SE3KMedoids


class GenesisMemory:
    """
    Genesis memory: deterministic Sierpinski initialization + SE(3) clustering refinement.

    Integrates:
    - Sierpinski N-simplex fractal initialization for deterministic, sparse, hierarchical latent space.
    - SE(3) K-Medoids clustering for geometrically consistent memory organization on rigid-body manifold.

    Attributes:
        n_dim: Embedding dimension.
        n_clusters: Number of memory clusters (medoids).
        sierpinski_depth: Depth of Sierpinski chaos game iterations.
        device: PyTorch device ('cuda', 'cpu', etc.).
        clusterer: SE3KMedoids instance.
        memory_bank: Current memory bank tensor (n_clusters, n_dim) or None if not initialized.
    """

    def __init__(
        self,
        n_dim: int,
        n_clusters: int,
        sierpinski_depth: int = 3,
        device: Optional[str] = None,
    ):
        """
        Initialize Genesis memory.

        Args:
            n_dim: Embedding dimension (must be >= 1).
            n_clusters: Number of memory clusters (medoids) (must be >= 1).
            sierpinski_depth: Depth of Sierpinski chaos game iterations (default: 3).
            device: PyTorch device ('cuda', 'cpu', etc.). Defaults to 'cuda' if available.

        Raises:
            ValueError: If n_dim < 1, n_clusters < 1, or sierpinski_depth < 1.
        """
        if n_dim < 1:
            raise ValueError(f"n_dim must be >= 1, got {n_dim}")
        if n_clusters < 1:
            raise ValueError(f"n_clusters must be >= 1, got {n_clusters}")
        if sierpinski_depth < 1:
            raise ValueError(f"sierpinski_depth must be >= 1, got {sierpinski_depth}")

        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"

        self.n_dim = n_dim
        self.n_clusters = n_clusters
        self.sierpinski_depth = sierpinski_depth
        self.device = device
        self.clusterer = SE3KMedoids(n_clusters=n_clusters)
        self.memory_bank: Optional[torch.Tensor] = None

    def initialize(self, seed: int = 1234) -> torch.Tensor:
        """
        Initialize memory bank with Sierpinski fractal centroids.

        Generates deterministic set of centroids using chaos game iteration.
        If more centroids are generated than `n_clusters`, downsamples to `n_clusters`
        by selecting first `n_clusters` centroids.

        Args:
            seed: Random seed for Sierpinski generation (ensures determinism).

        Returns:
            Memory bank tensor (n_clusters, n_dim) on GPU.

        Raises:
            RuntimeError: If Sierpinski generation fails or produces insufficient centroids.
        """
        # Generate Sierpinski centroids
        # Generate exactly n_clusters centroids (avoid generating huge banks then slicing).
        centroids = generate_sierpinski_centroids(
            n_dim=self.n_dim,
            depth=self.sierpinski_depth,
            n_centroids=self.n_clusters,
            seed=seed,
            device=self.device,
        )

        self.memory_bank = centroids
        return centroids

    def refine(
        self,
        embeddings: torch.Tensor,
        convert_to_dual_quat: bool = True,
    ) -> torch.Tensor:
        """
        Refine memory bank using SE(3) K-Medoids clustering.

        Runs SE(3) clustering on embeddings to reorganize memory bank into geometrically
        consistent medoids on rigid-body manifold.

        Args:
            embeddings: Embedding tensor (n_points, n_dim) on GPU.
            convert_to_dual_quat: If True, converts embeddings to dual quaternions (n_points, 8).
                If False, assumes embeddings are already in dual quaternion format.
                NOTE: Conversion from arbitrary embeddings requires projection (not implemented yet).
                For now, assumes embeddings are already in SE(3) format or uses identity mapping.

        Returns:
            Refined memory bank (medoids) tensor (n_clusters, 8) on GPU (if convert_to_dual_quat=True)
            or (n_clusters, n_dim) (if convert_to_dual_quat=False).

        Raises:
            ValueError: If embeddings shape is not (n_points, n_dim) or n_points < n_clusters.
            RuntimeError: If clustering fails.
        """
        if embeddings.dim() != 2:
            raise ValueError(f"embeddings must be 2D (n_points, n_dim), got shape {embeddings.shape}")

        n_points = embeddings.shape[0]
        if n_points < self.n_clusters:
            raise ValueError(
                f"n_points ({n_points}) must be >= n_clusters ({self.n_clusters})"
            )

        # Convert to dual quaternions if needed
        if convert_to_dual_quat:
            # TODO: Implement proper conversion from arbitrary embeddings to SE(3) dual quaternions.
            # For now, assume embeddings are already in SE(3) format or use identity mapping.
            # If embeddings are (n_points, n_dim) with n_dim != 8, we need to project them.
            if embeddings.shape[1] == 8:
                # Already dual quaternions
                dq_embeddings = embeddings
            else:
                # Project embeddings to SE(3) format
                # Simple approach: pad or truncate to (n_points, 8)
                # Real part (rotation quaternion): first 4 dims, normalized
                # Dual part (translation quaternion): next 3 dims, padded with 0
                if embeddings.shape[1] >= 4:
                    # Extract rotation quaternion (first 4 dims)
                    rot = embeddings[:, :4]  # (n_points, 4)
                    rot_norm = torch.norm(rot, dim=1, keepdim=True)
                    rot_normalized = rot / (rot_norm + 1e-8)
                    # Extract translation (next 3 dims, or zeros)
                    if embeddings.shape[1] >= 7:
                        trans = embeddings[:, 4:7]  # (n_points, 3)
                    else:
                        trans = torch.zeros(n_points, 3, device=embeddings.device, dtype=embeddings.dtype)
                    # Construct dual quaternion: [wr, xr, yr, zr, 0, tx, ty, tz]
                    # Translation quaternion: [0, tx/2, ty/2, tz/2] (simplified)
                    dual_w = torch.zeros(n_points, 1, device=embeddings.device, dtype=embeddings.dtype)
                    dual_xyz = trans / 2.0
                    dual = torch.cat([dual_w, dual_xyz], dim=1)  # (n_points, 4)
                    dq_embeddings = torch.cat([rot_normalized, dual], dim=1)  # (n_points, 8)
                else:
                    # Not enough dimensions, use identity dual quaternion
                    identity = torch.zeros(n_points, 8, device=embeddings.device, dtype=embeddings.dtype)
                    identity[:, 0] = 1.0  # w = 1, others = 0
                    dq_embeddings = identity
        else:
            # Assume embeddings are already dual quaternions
            if embeddings.shape[1] != 8:
                raise ValueError(
                    f"If convert_to_dual_quat=False, embeddings must have last dim=8, "
                    f"got {embeddings.shape[1]}"
                )
            dq_embeddings = embeddings

        # Run SE(3) clustering
        labels, medoids = self.clusterer.fit(dq_embeddings)

        # Update memory bank
        self.memory_bank = medoids

        return medoids
