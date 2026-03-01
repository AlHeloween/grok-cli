from __future__ import annotations

import hashlib
import json
import os
import random
import subprocess
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore

try:
    import numpy as np
    _NUMPY_AVAILABLE = True
except ImportError:
    _NUMPY_AVAILABLE = False
    np = None  # type: ignore


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_run_id() -> str:
    return uuid.uuid4().hex


def stable_json_hash(payload: dict[str, Any]) -> str:
    """
    Hash a JSON-serializable object deterministically.

    - Keys sorted
    - No whitespace
    """

    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


@dataclass(frozen=True)
class GitInfo:
    rev: Optional[str]
    dirty: Optional[bool]
    error: Optional[str]


def _repo_root() -> Path:
    # aurora_genesis_core/utils/artifacts.py -> repo root
    return Path(__file__).resolve().parents[2]


def git_info(*, cwd: Optional[Path] = None) -> GitInfo:
    root = cwd or _repo_root()
    env = {**os.environ}
    try:
        rev = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(root),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if rev.returncode != 0:
            return GitInfo(rev=None, dirty=None, error=rev.stderr.strip() or rev.stdout.strip() or "git rev-parse failed")
        sha = (rev.stdout or "").strip() or None

        st = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(root),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if st.returncode != 0:
            return GitInfo(rev=sha, dirty=None, error=st.stderr.strip() or st.stdout.strip() or "git status failed")
        dirty = bool((st.stdout or "").strip())
        return GitInfo(rev=sha, dirty=dirty, error=None)
    except Exception as e:
        return GitInfo(rev=None, dirty=None, error=repr(e))


def set_all_seeds(seed: int) -> None:
    """
    Set all random seeds for reproducibility.
    
    Sets:
    - Python random
    - NumPy (if available)
    - PyTorch (if available)
    - PyTorch CUDA (if available)
    
    Args:
        seed: Random seed value
    """
    random.seed(seed)
    if _NUMPY_AVAILABLE and np is not None:
        np.random.seed(seed)
    if _TORCH_AVAILABLE and torch is not None:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
            # Enable deterministic operations (may impact performance)
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False


def build_run_metadata(
    *,
    inputs: dict[str, Any],
    seed: Optional[int] = None,
    artifacts: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """
    Standard artifact metadata block for JSON outputs.
    
    Args:
        inputs: Input parameters dictionary (used for inputs_hash)
        seed: Random seed used (if provided)
        artifacts: Dictionary mapping artifact names to file paths
    
    Returns:
        Dictionary with standard metadata fields:
        - run_id: Unique run identifier
        - timestamp_utc: UTC timestamp in ISO format
        - inputs_hash: SHA256 hash of inputs (for reproducibility checks)
        - git_rev: Git revision (short SHA)
        - git_dirty: Whether working directory is dirty
        - git_error: Error message if git info failed
        - python: Python version
        - seed: Random seed (if provided)
        - artifacts: Artifact file paths (if provided)
    """
    gi = git_info()
    metadata: dict[str, Any] = {
        "run_id": new_run_id(),
        "timestamp_utc": utc_now_iso(),
        "inputs_hash": stable_json_hash(inputs),
        "git_rev": gi.rev,
        "git_dirty": gi.dirty,
        "git_error": gi.error,
        "python": sys.version.split()[0],
    }
    
    if seed is not None:
        metadata["seed"] = int(seed)
    
    if artifacts is not None:
        metadata["artifacts"] = {k: str(Path(v).as_posix()) for k, v in artifacts.items()}
    
    return metadata

