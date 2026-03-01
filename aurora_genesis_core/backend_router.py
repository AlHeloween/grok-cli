"""
CUDA/Vulkan backend router (auto-bench + cache).

Purpose:
- Run the existing GPU benchmark once (CUDA vs Vulkan) and cache per-operator
  timings to a gitignored cache file under `.cache/`.
- Provide a small API to choose the fastest backend for a given op name, with
  manual override via environment variable.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional

Backend = Literal["cuda", "vulkan"]


@dataclass(frozen=True)
class BenchResult:
    cuda: dict[str, float]
    vulkan: dict[str, float]
    faster: str


def repo_root() -> Path:
    # aurora_genesis_core/backend_router.py -> repo root
    return Path(__file__).resolve().parents[3]
 

def cache_path() -> Path:
    return repo_root() / ".cache" / "aurora_router.json"


def run_bench() -> BenchResult:
    root = repo_root()
    bench_cmd = root / "aurora_tests_not_for_production" / "legacy" / "gpu_games" / "_run_benchmark.cmd"
    if os.name == "nt" and bench_cmd.exists():
        # On Windows, nvcc requires a host compiler (cl.exe). The repo provides
        # `gpu_games/_run_benchmark.cmd` which enters a VS dev shell then runs the bench.
        cmd = ["cmd.exe", "/c", str(bench_cmd)]
    else:
        cmd = [
            "cargo",
            "run",
            "--release",
            "--manifest-path",
            str(root / "aurora_tests_not_for_production" / "legacy" / "gpu_games" / "rust" / "Cargo.toml"),
            "-p",
            "bench_gpu_rs",
            "--",
            "--json",
        ]
    proc = subprocess.run(cmd, cwd=root, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"GPU bench failed: {' '.join(cmd)}\n{proc.stderr}")
    # Find the last JSON object line (cargo logs may precede it).
    lines = (proc.stdout or "").splitlines()
    if not lines:
        lines = (proc.stderr or "").splitlines()
    payload = None
    for line in reversed(lines):
        s = line.strip()
        if s.startswith("{") and s.endswith("}"):
            payload = s
            break
    if payload is None:
        raise RuntimeError(f"GPU bench did not emit JSON payload. stdout_tail={lines[-5:]}")
    data = json.loads(payload)
    return BenchResult(cuda=dict(data["cuda"]), vulkan=dict(data["vulkan"]), faster=str(data.get("faster", "")))


def _choose_from_dicts(op: str, cuda: dict[str, float], vulkan: dict[str, float], *, default: Backend) -> Backend:
    c = cuda.get(op)
    v = vulkan.get(op)
    if c is None and v is None:
        return default
    if c is None:
        return "vulkan"
    if v is None:
        return "cuda"
    return "cuda" if c <= v else "vulkan"


def build_router_cache(result: BenchResult) -> dict[str, object]:
    ops = sorted(set(result.cuda.keys()) | set(result.vulkan.keys()))
    per_op: dict[str, Backend] = {}
    for op in ops:
        per_op[op] = _choose_from_dicts(op, result.cuda, result.vulkan, default="cuda")

    return {
        "schema": 1,
        "cuda": result.cuda,
        "vulkan": result.vulkan,
        "per_op": per_op,
        "faster": result.faster,
    }


def write_cache(cache: dict[str, object]) -> Path:
    path = cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=2, sort_keys=True), encoding="utf-8")
    return path


def load_cache() -> Optional[dict[str, object]]:
    path = cache_path()
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_cache(*, refresh: bool = False) -> dict[str, object]:
    existing = None if refresh else load_cache()
    if existing is not None:
        return existing
    result = run_bench()
    cache = build_router_cache(result)
    write_cache(cache)
    return cache


def choose_backend(op_name: str, *, default: Backend = "cuda") -> Backend:
    force = os.environ.get("AURORA_BACKEND_FORCE")
    if force in ("cuda", "vulkan"):
        return force

    cache = load_cache()
    if cache is None:
        cache = ensure_cache()
    per_op = cache.get("per_op", {})
    if isinstance(per_op, dict) and op_name in per_op:
        v = per_op[op_name]
        if v in ("cuda", "vulkan"):
            return v
    return default

