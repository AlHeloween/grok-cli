'''Sierpinski simplex centroid generator. GPU-accelerated deterministic fractal initialization.'''

from __future__ import annotations

import math
from typing import Optional

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore


if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.fractal.sierpinski requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )


def regular_simplex_vertices(n_dim: int, device: Optional[str] = None) -> torch.Tensor:
    """
    Generate vertices of a regular N-simplex centered at origin.

    Algorithm: Place first vertex at (1, 0, ..., 0), then use Gram-Schmidt
    to generate orthogonal unit vectors. The simplex vertices are then
    normalized to lie on the unit sphere.

    Args:
        n_dim: Number of dimensions (N-simplex has N+1 vertices).
        device: PyTorch device ('cuda', 'cpu', etc.). Defaults to 'cuda' if available.

    Returns:
        Tensor of shape (n_dim + 1, n_dim) with vertices on unit sphere.

    Raises:
        ValueError: If n_dim < 1.
    """
    if n_dim < 1:
        raise ValueError(f"n_dim must be >= 1, got {n_dim}")

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    # For small dimensions, use explicit formulas
    if n_dim == 1:
        # 1D simplex (line segment): vertices at -1 and +1
        vertices = torch.tensor([[-1.0], [1.0]], device=device)
    elif n_dim == 2:
        # 2D simplex (triangle): equilateral triangle
        sqrt3 = math.sqrt(3.0)
        vertices = torch.tensor(
            [[-1.0, -sqrt3 / 3], [1.0, -sqrt3 / 3], [0.0, 2 * sqrt3 / 3]],
            device=device,
        )
        # Normalize to unit circle
        norms = torch.norm(vertices, dim=1, keepdim=True)
        vertices = vertices / (norms + 1e-8)
    elif n_dim == 3:
        # 3D simplex (tetrahedron): regular tetrahedron
        sqrt3 = math.sqrt(3.0)
        sqrt6 = math.sqrt(6.0)
        vertices = torch.tensor(
            [
                [-1.0, -1.0 / sqrt3, -1.0 / sqrt6],
                [1.0, -1.0 / sqrt3, -1.0 / sqrt6],
                [0.0, 2.0 / sqrt3, -1.0 / sqrt6],
                [0.0, 0.0, 3.0 / sqrt6],
            ],
            device=device,
        )
        # Normalize to unit sphere
        norms = torch.norm(vertices, dim=1, keepdim=True)
        vertices = vertices / (norms + 1e-8)
    else:
        # General case: use QR decomposition to generate orthogonal vectors
        # Start with identity-like matrix, then orthogonalize
        eye_like = torch.eye(n_dim + 1, n_dim, device=device)
        # First vertex at (1, 0, ..., 0)
        eye_like[0, 0] = 1.0
        # Subsequent vertices shifted to form simplex
        for i in range(1, n_dim + 1):
            eye_like[i, i - 1] = 1.0 - (1.0 / (n_dim + 1))
            eye_like[i, :i] = -1.0 / (n_dim + 1)

        # Normalize to unit sphere
        norms = torch.norm(eye_like, dim=1, keepdim=True)
        vertices = eye_like / (norms + 1e-8)

    return vertices


def generate_sierpinski_centroids(
    n_dim: int,
    depth: int,
    n_centroids: Optional[int] = None,
    seed: int = 1234,
    device: Optional[str] = None,
) -> torch.Tensor:
    """
    Generate Sierpinski N-simplex centroids using chaos game iteration.

    Algorithm:
    1. Generate regular N-simplex vertices using `regular_simplex_vertices()`.
    2. For each centroid (determined by `depth`), perform chaos game:
       - Start at origin.
       - For `depth` iterations:
         - Choose a random vertex (via seeded LCG).
         - Move to midpoint between current point and chosen vertex.
    3. Returns deterministic set of centroids on GPU.

    LCG: state = (state * 1664525 + 1013904223) % 2^32
    (Matches CUDA header `lib/fractal_sierpinski.h`)

    Args:
        n_dim: Number of dimensions (determines N-simplex type).
        depth: Number of chaos game iterations per centroid.
        seed: Random seed for LCG (ensures determinism).
        device: PyTorch device ('cuda', 'cpu', etc.). Defaults to 'cuda' if available.

    Returns:
        Tensor of shape (2^(n_dim * depth), n_dim) with centroids on GPU.
        NOTE: For large n_dim * depth, this is intractable. Use depth=1-2 and downsample.

    Raises:
        ValueError: If n_dim < 1 or depth < 1.
    """
    if n_dim < 1:
        raise ValueError(f"n_dim must be >= 1, got {n_dim}")
    if depth < 1:
        raise ValueError(f"depth must be >= 1, got {depth}")

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    # Generate simplex vertices
    vertices = regular_simplex_vertices(n_dim, device=device)
    n_vertices = vertices.shape[0]  # n_dim + 1

    # Number of centroids: 2^(n_dim * depth) is intractable for large values.
    # For practical use, allow callers (e.g. memory init) to request exactly N.
    # If N is not provided, we fall back to the original behavior with a cap.
    max_centroids = 65536
    if n_centroids is None:
        n_centroids_target = 2 ** (n_dim * depth)
        if n_centroids_target > max_centroids:
            # Use depth=1 and generate max_centroids instead (bounded runtime).
            depth_actual = 1
            n_centroids_effective = max_centroids
        else:
            depth_actual = depth
            n_centroids_effective = n_centroids_target
    else:
        if n_centroids < 1:
            raise ValueError(f"n_centroids must be >= 1, got {n_centroids}")
        depth_actual = depth
        n_centroids_effective = min(int(n_centroids), max_centroids)

    # LCG constants (matches CUDA header)
    LCG_MULT = 1664525
    LCG_ADD = 1013904223

    # Vectorized chaos game:
    # Maintain one RNG state per centroid and update all points in parallel.
    idx = torch.arange(n_centroids_effective, device=device, dtype=torch.int64)
    state = ((seed & 0xFFFFFFFF) ^ ((idx * 747796405) & 0xFFFFFFFF)) & 0xFFFFFFFF

    centroids = torch.zeros(
        (n_centroids_effective, n_dim),
        device=device,
        dtype=torch.float32,
    )

    for _ in range(depth_actual):
        state = ((state * LCG_MULT) + LCG_ADD) & 0xFFFFFFFF
        vertex_idx = torch.remainder(state, n_vertices).to(dtype=torch.long)
        centroids = (centroids + vertices[vertex_idx]) * 0.5

    return centroids
