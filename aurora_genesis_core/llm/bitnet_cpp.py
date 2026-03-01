from __future__ import annotations

import os
import platform
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence


def resolve_external_bitnet_dir(*, required: bool = False) -> Optional[Path]:
    """
    Resolve the expected BitNet checkout location: `external/bitnet/`.

    This repo does not vendor BitNet; `external/` is gitignored and typically
    contains local clones.
    """

    repo_root = Path(__file__).resolve().parents[2]
    candidate = repo_root / "external" / "bitnet"
    if candidate.exists():
        return candidate
    if required:
        raise FileNotFoundError(f"BitNet checkout not found at: {candidate}")
    return None


def _resolve_llama_bin(*, build_dir: Path, exe_base: str) -> Path:
    """
    Match BitNet's run_inference.py / run_inference_server.py layout:
    - Windows: build/bin/Release/<exe>.exe (fallback: build/bin/<exe>.exe, then build/bin/<exe>)
    - Others: build/bin/<exe>
    """

    if platform.system() == "Windows":
        # Try Release subdirectory first (Visual Studio generator)
        p1 = build_dir / "bin" / "Release" / f"{exe_base}.exe"
        if p1.exists():
            return p1
        # Try bin directory directly (Ninja/Unix Makefiles generator)
        p2 = build_dir / "bin" / f"{exe_base}.exe"
        if p2.exists():
            return p2
        # Try without .exe extension
        p3 = build_dir / "bin" / exe_base
        if p3.exists():
            return p3
    else:
        p = build_dir / "bin" / exe_base
        if p.exists():
            return p
    raise FileNotFoundError(f"Unable to find {exe_base} under build dir: {build_dir}")


def resolve_llama_cli_path(*, bitnet_dir: Optional[Path] = None, required: bool = False) -> Optional[Path]:
    """
    Resolve BitNet's built `llama-cli` binary.
    """

    root = bitnet_dir or resolve_external_bitnet_dir(required=required)
    if root is None:
        return None
    build_dir = root / "build"
    if not build_dir.exists():
        if required:
            raise FileNotFoundError(f"BitNet build dir not found at: {build_dir}")
        return None
    return _resolve_llama_bin(build_dir=build_dir, exe_base="llama-cli")


@dataclass(frozen=True)
class BitNetCppCliConfig:
    model_gguf: str
    ctx_size: int = 2048
    n_predict: int = 64
    threads: int = 2
    temperature: float = 0.0
    ngl: int = 0


def _strip_echoed_prompt(*, stdout: str, prompt: str) -> str:
    """
    Best-effort removal of prompt echo from llama-cli output.

    We use this because the benchmark correctness checks must not see the
    notebook facts in the prompt (otherwise correctness becomes trivial).
    """

    if not stdout:
        return ""
    if not prompt:
        return stdout.strip()

    idx = stdout.rfind(prompt)
    if idx >= 0:
        return stdout[idx + len(prompt) :].strip()
    return stdout.strip()


def bitnet_cpp_generate(
    *,
    prompt: str,
    cfg: BitNetCppCliConfig,
    llama_cli_path: Optional[Path] = None,
    bitnet_dir: Optional[Path] = None,
    extra_args: Sequence[str] = (),
) -> tuple[str, float]:
    """
    Generate text via BitNet's `llama-cli` binary and return (completion, wall_s).

    Requires:
    - a built BitNet checkout under `external/bitnet/` (or provided `bitnet_dir`)
    - a local gguf model file (cfg.model_gguf)
    """

    if not str(cfg.model_gguf).strip():
        raise ValueError("cfg.model_gguf must be set to a local gguf model file")
    model_path = Path(cfg.model_gguf)
    if not model_path.is_absolute():
        model_path = model_path.resolve()
    if not model_path.exists():
        raise FileNotFoundError(f"BitNet gguf model not found at: {model_path}")

    bitnet_root = bitnet_dir or resolve_external_bitnet_dir(required=True)
    if bitnet_root is None:
        raise FileNotFoundError("Unable to resolve BitNet checkout directory")

    llama_cli = llama_cli_path or resolve_llama_cli_path(bitnet_dir=bitnet_dir, required=True)
    if llama_cli is None:
        raise FileNotFoundError("Unable to resolve llama-cli path")

    if int(cfg.ctx_size) < 128:
        raise ValueError(f"ctx_size must be >= 128, got {cfg.ctx_size}")
    if int(cfg.n_predict) < 1:
        raise ValueError(f"n_predict must be >= 1, got {cfg.n_predict}")
    if int(cfg.threads) < 1:
        raise ValueError(f"threads must be >= 1, got {cfg.threads}")
    if int(cfg.ngl) < 0:
        raise ValueError(f"ngl must be >= 0, got {cfg.ngl}")

    # On Windows, very large prompts can exceed the CreateProcess command-line length
    # limit when passed as a `-p` argument. We fail early with a clearer error.
    if platform.system() == "Windows":
        if len(prompt) > 30000:
            raise ValueError(
                "Prompt is too large to pass via llama-cli `-p` on Windows. "
                "Use smaller benchmark sizes (facts_list), prefer retrieval (short prompt), "
                "or run llama-server and use an HTTP client backend."
            )

    args = [
        str(llama_cli),
        "-m",
        str(model_path),
        "-n",
        str(int(cfg.n_predict)),
        "-t",
        str(int(cfg.threads)),
        "-p",
        str(prompt),
        "-c",
        str(int(cfg.ctx_size)),
        "--temp",
        str(float(cfg.temperature)),
        "-b",
        "1",
        "-ngl",
        str(int(cfg.ngl)),
    ]
    args.extend([str(a) for a in extra_args])

    t0 = time.perf_counter()
    proc = subprocess.run(
        args,
        cwd=str(bitnet_root),
        check=False,
        capture_output=True,
        text=True,
        env={**os.environ},
    )
    wall = time.perf_counter() - t0
    if proc.returncode != 0:
        raise RuntimeError(
            "BitNet llama-cli failed "
            f"(code={proc.returncode}). stderr={proc.stderr.strip()!r} stdout={proc.stdout.strip()!r}"
        )

    completion = _strip_echoed_prompt(stdout=proc.stdout, prompt=str(prompt))
    return completion, float(wall)
