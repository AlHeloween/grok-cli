from __future__ import annotations

import hashlib
import os
import platform
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence


def resolve_external_litert_lm_dir(*, required: bool = False) -> Optional[Path]:
    """
    Resolve the expected LiteRT-LM CLI location: `external/litert_lm/`.

    This repo does not vendor LiteRT-LM; `external/` is gitignored and typically
    contains local tools and clones.
    """

    repo_root = Path(__file__).resolve().parents[2]
    candidate = repo_root / "external" / "litert_lm"
    if candidate.exists():
        return candidate
    if required:
        raise FileNotFoundError(f"LiteRT-LM directory not found at: {candidate}")
    return None


def resolve_lit_cli_path(*, required: bool = False, litert_dir: Optional[Path] = None) -> Optional[Path]:
    """
    Resolve the `lit` CLI binary.

    Search order:
    1) env AURORA_LITERT_LIT (explicit path)
    2) `external/litert_lm/lit.exe` (Windows) or `external/litert_lm/lit` (others)
    3) `lit` on PATH
    """

    env = os.environ.get("AURORA_LITERT_LIT", "").strip()
    if env:
        p = Path(env)
        if p.exists():
            return p
        if required:
            raise FileNotFoundError(f"AURORA_LITERT_LIT points to missing file: {p}")
        return None

    root = litert_dir or resolve_external_litert_lm_dir(required=False)
    if root is not None:
        if platform.system() == "Windows":
            p = root / "lit.exe"
        else:
            p = root / "lit"
        if p.exists():
            return p

    # Best-effort PATH lookup (does not guarantee LiteRT-LM's `lit`).
    from shutil import which

    found = which("lit")
    if found:
        return Path(found)

    if required:
        raise FileNotFoundError(
            "Unable to resolve LiteRT-LM `lit` CLI. "
            "Set env AURORA_LITERT_LIT to the path of the LiteRT-LM `lit` binary, "
            "or place it at external/litert_lm/lit(.exe)."
        )
    return None


@dataclass(frozen=True)
class LiteRTLitCliConfig:
    model: str
    backend: str = "cpu"  # lit supports 'cpu' and 'gpu'
    min_log_level: int = 4
    prompt_dir: str = ".cache/litert_lm/prompts"


def _write_prompt_file(*, prompt: str, prompt_dir: str) -> Path:
    if not str(prompt_dir).strip():
        raise ValueError("prompt_dir must be non-empty")
    pdir = Path(prompt_dir)
    pdir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.md5(prompt.encode("utf-8")).hexdigest()
    path = pdir / f"prompt_{digest}.txt"
    # Idempotent write: avoid changing timestamps if content already matches.
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if existing == prompt:
            return path
    path.write_text(prompt, encoding="utf-8")
    return path


def litert_lm_generate(
    *,
    prompt: str,
    cfg: LiteRTLitCliConfig,
    lit_cli_path: Optional[Path] = None,
    litert_dir: Optional[Path] = None,
    cwd: Optional[Path] = None,
    extra_args: Sequence[str] = (),
) -> tuple[str, float]:
    """
    Generate text via LiteRT-LM `lit run` and return (completion, wall_s).

    Notes:
    - Uses `--input_prompt_file` to avoid Windows command-line length limits.
    - The LiteRT-LM CLI stores models in `.litert-lm/models` under the working directory.
      For reproducibility, we default cwd to the repo root.
    """

    model = str(cfg.model).strip()
    if not model:
        raise ValueError("cfg.model must be non-empty (e.g. 'gemma3-1b')")
    backend = str(cfg.backend).strip().lower()
    if backend not in ("cpu", "gpu"):
        raise ValueError("cfg.backend must be 'cpu' or 'gpu'")
    if int(cfg.min_log_level) < 0:
        raise ValueError("cfg.min_log_level must be >= 0")

    lit = lit_cli_path or resolve_lit_cli_path(required=True, litert_dir=litert_dir)
    if lit is None:
        raise FileNotFoundError("Unable to resolve LiteRT-LM `lit` binary.")

    prompt_file = _write_prompt_file(prompt=prompt, prompt_dir=str(cfg.prompt_dir))

    repo_root = Path(__file__).resolve().parents[2]
    run_cwd = cwd or repo_root

    args = [
        str(lit),
        "--min_log_level",
        str(int(cfg.min_log_level)),
        "run",
        model,
        "--backend",
        backend,
        "-f",
        str(prompt_file),
    ]
    args.extend([str(a) for a in extra_args])

    t0 = time.perf_counter()
    proc = subprocess.run(
        args,
        cwd=str(run_cwd),
        check=False,
        capture_output=True,
        text=True,
        env={**os.environ},
    )
    wall = time.perf_counter() - t0
    if proc.returncode != 0:
        raise RuntimeError(
            "LiteRT-LM `lit run` failed "
            f"(code={proc.returncode}). stderr={proc.stderr.strip()!r} stdout={proc.stdout.strip()!r}"
        )
    return proc.stdout.strip(), float(wall)

