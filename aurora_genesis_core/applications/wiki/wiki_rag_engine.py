from __future__ import annotations

import os
import json
import hashlib
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from aurora_genesis_core.applications.wiki.wiki_rag import (
    BuildIndexStats,
    build_rag_prompt,
    index_wiki_chunks,
    iter_wiki_chunks_from_dataset,
)
from aurora_genesis_core.llm.bitnet_cpp import BitNetCppCliConfig, bitnet_cpp_generate
from aurora_genesis_core.memory.text_fractal_memory import TextMemoryEntry, build_text_memory_banks
from aurora_genesis_core.memory.text_fractal_memory_io import load_text_memory_banks, save_text_memory_banks
from aurora_genesis_core.utils.settings import load_settings


ProgressFn = Callable[[dict[str, Any]], None]


def _require_datasets() -> Any:
    try:
        import datasets  # type: ignore
    except Exception as e:
        raise ImportError("Wiki RAG requires `datasets`. Install extras: `uv pip install -e .[wiki]`.") from e
    return datasets


@dataclass(frozen=True)
class WikiRagConfig:
    dataset_dir: str = ".cache/wiki/en_50k"
    cache_dir: str = ".cache/wiki_rag_index"
    max_articles: int = 5000
    chunk_chars: int = 800
    chunk_overlap: int = 120
    max_chunks_per_article: int = 2
    index_progress_every: int = 2000

    mem_clusters: int = 4096
    mem_dim: int = 128
    mem_depth: int = 2
    mem_seed: int = 1234

    candidate_slots: int = 8
    top_k: int = 6

    max_context_chars: int = 6000
    max_history_turns: int = 4


@dataclass(frozen=True)
class WikiRagTurn:
    question: str
    answer: str
    retrieve_wall_s: float
    gen_wall_s: float
    prompt_chars: int
    retrieved: list[dict[str, Any]]


class WikiRagEngine:
    def __init__(self, *, cfg: WikiRagConfig) -> None:
        self.cfg = cfg
        self._ds: Any = None
        self._banks = build_text_memory_banks(
            n_clusters=int(cfg.mem_clusters),
            dim=int(cfg.mem_dim),
            depth=int(cfg.mem_depth),
            seed=int(cfg.mem_seed),
            allow_quarantine_read=False,
        )
        self._history: list[tuple[str, str]] = []
        self._index_stats: Optional[BuildIndexStats] = None

    @property
    def index_stats(self) -> Optional[BuildIndexStats]:
        return self._index_stats

    def reset_history(self) -> None:
        self._history = []

    def build_index(self, *, progress: Optional[ProgressFn] = None) -> BuildIndexStats:
        dataset_dir = str(self.cfg.dataset_dir).strip()
        if not dataset_dir:
            settings = load_settings()
            if settings.wiki_dataset_dir:
                dataset_dir = str(settings.wiki_dataset_dir).strip()
        if not dataset_dir:
            dataset_dir = ".cache/wiki/en_50k"
        ds_path = Path(dataset_dir)
        if not ds_path.exists():
            raise FileNotFoundError(f"dataset_dir not found: {ds_path.as_posix()}")

        cache_root = Path(str(self.cfg.cache_dir))
        cache_key = _compute_cache_key(cfg=self.cfg, dataset_dir=ds_path)
        cache_path = cache_root / cache_key

        if progress is not None:
            progress({"type": "stage", "stage": "load_dataset", "msg": ds_path.as_posix()})

        if cache_path.exists():
            meta_path = cache_path / "meta.json"
            if meta_path.exists():
                if progress is not None:
                    progress({"type": "stage", "stage": "cache_hit", "msg": cache_path.as_posix()})
                banks, meta = load_text_memory_banks(out_dir=cache_path.as_posix())
                self._banks = banks
                stats_raw = meta.get("index_stats")
                if isinstance(stats_raw, dict):
                    self._index_stats = BuildIndexStats(
                        chunks_added=int(stats_raw.get("chunks_added", 0)),
                        chunks_skipped_dedup=int(stats_raw.get("chunks_skipped_dedup", 0)),
                        wall_s=float(stats_raw.get("wall_s", 0.0)),
                    )
                    return self._index_stats

        datasets = _require_datasets()
        t0 = time.perf_counter()
        ds = datasets.load_from_disk(ds_path.as_posix())
        load_wall = time.perf_counter() - t0
        self._ds = ds
        n_total = int(len(ds)) if hasattr(ds, "__len__") else -1
        if progress is not None:
            progress({"type": "metric", "name": "dataset_rows", "value": n_total})
            progress({"type": "metric", "name": "load_wall_s", "value": float(load_wall)})
            progress({"type": "stage", "stage": "index", "msg": "building memory banks"})

        chunks = iter_wiki_chunks_from_dataset(
            ds=ds,
            max_articles=int(self.cfg.max_articles),
            chunk_chars=int(self.cfg.chunk_chars),
            chunk_overlap=int(self.cfg.chunk_overlap),
            max_chunks_per_article=int(self.cfg.max_chunks_per_article),
        )

        if progress is None:
            stats = index_wiki_chunks(
                banks=self._banks,
                chunks=chunks,
                progress_every=int(self.cfg.index_progress_every),
                progress=None,
            )
        else:
            def prog(ev: dict[str, Any]) -> None:
                progress(ev)

            stats = index_wiki_chunks(
                banks=self._banks,
                chunks=chunks,
                progress_every=int(self.cfg.index_progress_every),
                progress=prog,
            )
            prog({"type": "metric", "name": "index_stats", "value": asdict(stats)})

        self._index_stats = stats

        # Persist cache.
        meta = {
            "cache_key": cache_key,
            "dataset_dir": ds_path.as_posix(),
            "dataset_state_json": _read_text_if_exists(ds_path / "state.json", limit_bytes=200_000),
            "dataset_info_json": _read_text_if_exists(ds_path / "dataset_info.json", limit_bytes=200_000),
            "index_stats": asdict(stats),
            "bank_config": {
                "n_clusters": int(self.cfg.mem_clusters),
                "dim": int(self.cfg.mem_dim),
                "depth": int(self.cfg.mem_depth),
                "seed": int(self.cfg.mem_seed),
                "allow_quarantine_read": False,
            },
            "rag_config": asdict(self.cfg),
        }
        cache_path.mkdir(parents=True, exist_ok=True)
        save_text_memory_banks(banks=self._banks, out_dir=cache_path.as_posix(), meta=meta)
        if progress is not None:
            progress({"type": "stage", "stage": "cache_saved", "msg": cache_path.as_posix()})

        return stats

    def ask(self, *, question: str, bitnet_cfg: BitNetCppCliConfig, progress: Optional[ProgressFn] = None) -> WikiRagTurn:
        q = str(question).strip()
        if not q:
            raise ValueError("question must be non-empty")

        if self._index_stats is None:
            raise RuntimeError("Index not built yet. Call build_index() first.")

        if progress is not None:
            progress({"type": "stage", "stage": "retrieve", "msg": q})
        t_retrieve0 = time.perf_counter()
        entries: list[TextMemoryEntry] = self._banks.query(
            text=q,
            candidate_slots=int(self.cfg.candidate_slots),
            top_k=int(self.cfg.top_k),
        )
        retrieve_wall = time.perf_counter() - t_retrieve0

        retrieved_blocks = [e.text for e in entries]
        prompt = build_rag_prompt(
            question=q,
            retrieved=retrieved_blocks,
            max_context_chars=int(self.cfg.max_context_chars),
            history=self._history,
            max_history_turns=int(self.cfg.max_history_turns),
        )

        if progress is not None:
            progress({"type": "stage", "stage": "generate", "msg": f"prompt_chars={len(prompt)}"})
        t_gen0 = time.perf_counter()
        completion, gen_wall = bitnet_cpp_generate(prompt=prompt, cfg=bitnet_cfg)
        if gen_wall <= 0:
            gen_wall = time.perf_counter() - t_gen0
        answer = str(completion).strip()

        self._history.append((q, answer))

        return WikiRagTurn(
            question=q,
            answer=answer,
            retrieve_wall_s=float(retrieve_wall),
            gen_wall_s=float(gen_wall),
            prompt_chars=int(len(prompt)),
            retrieved=[{"md5_tag": e.md5_tag, "information_mark": e.information_mark.value, "text": e.text} for e in entries],
        )


def resolve_bitnet_gguf_path(*, arg: Optional[str]) -> str:
    if arg is not None and str(arg).strip():
        return str(arg).strip()
    settings = load_settings()
    if settings.bitnet_gguf:
        return str(settings.bitnet_gguf).strip()
    env = os.environ.get("AURORA_BITNET_GGUF", "").strip()
    if env:
        return env
    raise ValueError("Provide --bitnet-model-gguf or set env AURORA_BITNET_GGUF.")


def _read_text_if_exists(p: Path, *, limit_bytes: int) -> Optional[str]:
    if not p.exists():
        return None
    data = p.read_bytes()
    if len(data) > int(limit_bytes):
        data = data[: int(limit_bytes)]
    return data.decode("utf-8", errors="replace")


def _compute_cache_key(*, cfg: WikiRagConfig, dataset_dir: Path) -> str:
    payload = {
        "dataset_dir": dataset_dir.as_posix(),
        "state_json": _read_text_if_exists(dataset_dir / "state.json", limit_bytes=200_000),
        "dataset_info_json": _read_text_if_exists(dataset_dir / "dataset_info.json", limit_bytes=200_000),
        "cfg": asdict(cfg),
    }
    s = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.md5(s.encode("utf-8")).hexdigest()
