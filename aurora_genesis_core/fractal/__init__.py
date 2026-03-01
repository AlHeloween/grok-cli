'''Fractal initialization: Sierpinski N-simplex centroid generation.'''

from __future__ import annotations

import importlib.util

if importlib.util.find_spec("torch") is None:
    __all__ = []
else:
    from aurora_genesis_core.fractal.sierpinski import (
        generate_sierpinski_centroids,
        regular_simplex_vertices,
    )

    __all__ = ["generate_sierpinski_centroids", "regular_simplex_vertices"]
