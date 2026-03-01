from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional


@dataclass(frozen=True)
class WikiSetsSpec:
    """
    Minimal spec for creating/loading a Wikipedia slice via the `wikisets` package.
    """

    language: str = "en"
    seed: int = 0
    date: str = "latest"
    # If True, always sample from the full "train" split. This can be slow because
    # wikisets' streaming reservoir sampling scans the entire stream.
    # Prefer False for fast "1000/5000/10000" sample splits when available.
    use_train_split: bool = False


def _require_wikisets() -> Any:
    try:
        import wikisets  # type: ignore
    except Exception as e:
        raise ImportError(
            "WikiSets track requires optional deps. Install with: `uv pip install -e .[wiki]` "
            "(or `pip install -e .[wiki]`)."
        ) from e
    return wikisets


def _require_datasets() -> Any:
    try:
        import datasets  # type: ignore
    except Exception as e:
        raise ImportError(
            "WikiSets track requires optional deps. Install with: `uv pip install -e .[wiki]` "
            "(or `pip install -e .[wiki]`)."
        ) from e
    return datasets


def build_wikisets_dataset(*, spec: WikiSetsSpec, limit: int) -> Any:
    """
    Return a HF `datasets.Dataset` (or DatasetDict) for a deterministic slice.

    We keep this wrapper very thin because `wikisets` is external and may change.
    """

    if int(limit) < 1:
        raise ValueError(f"limit must be >= 1, got {limit}")
    if not str(spec.language).strip():
        raise ValueError("language must be non-empty")
    if not str(spec.date).strip():
        raise ValueError("date must be non-empty")

    wikisets = _require_wikisets()
    _ = _require_datasets()

    # wikisets==0.1.x provides a `Wikiset` class with `.create(config)`.
    if not hasattr(wikisets, "Wikiset"):
        raise RuntimeError("Unsupported wikisets API (missing wikisets.Wikiset).")
    ds = wikisets.Wikiset.create(
        {
            "languages": [{"lang": str(spec.language), "size": int(limit)}],
            "date": str(spec.date),
            "use_train_split": bool(spec.use_train_split),
            "shuffle": False,
            "seed": int(spec.seed),
        }
    )

    if not hasattr(ds, "select") or not hasattr(ds, "__len__"):
        raise TypeError("Expected a datasets.Dataset-like object.")
    n = int(limit)
    n = min(n, int(len(ds)))
    ds = ds.select(list(range(n)))
    return ds


def save_dataset_to_disk(*, dataset: Any, out_dir: str) -> str:
    p = Path(out_dir)
    p.mkdir(parents=True, exist_ok=True)
    if not hasattr(dataset, "save_to_disk"):
        raise TypeError("Expected a datasets.Dataset-like object with save_to_disk().")
    dataset.save_to_disk(p.as_posix())
    return p.as_posix()


def load_dataset_from_disk(*, path: str) -> Any:
    datasets = _require_datasets()
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Dataset not found: {p.as_posix()}")
    return datasets.load_from_disk(p.as_posix())
