'''SE(3) utilities: dual-quaternion geodesic distance and K-Medoids clustering.'''

from __future__ import annotations

import importlib.util

if importlib.util.find_spec("torch") is None:
    __all__ = []
else:
    from aurora_genesis_core.se3.kmedoids import SE3KMedoids, dual_quat_geodesic_distance

    __all__ = ["SE3KMedoids", "dual_quat_geodesic_distance"]
