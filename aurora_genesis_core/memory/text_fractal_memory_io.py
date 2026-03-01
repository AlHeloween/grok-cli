from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch

from aurora_genesis_core.memory.text_fractal_memory import TextFractalMemoryBank, TextFractalMemoryBanks, TextMemoryEntry
from deepseek_adapter.adid_memory import InformationMark

# Optional FFE/lattice support
try:
    from aurora_genesis_core.memory.lattice_storage import LatticeMemoryStorage
    from aurora_genesis_core.memory.lattice_memory_bank import LatticeMemoryBank
    _LATTICE_AVAILABLE = True
except ImportError:
    _LATTICE_AVAILABLE = False
    LatticeMemoryStorage = None  # type: ignore
    LatticeMemoryBank = None  # type: ignore


def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _save_bank(*, bank: TextFractalMemoryBank, out_dir: Path, name: str) -> None:
    # Flatten entries + embeddings.
    meta_entries: list[dict[str, Any]] = []
    embs: list[np.ndarray] = []
    embs_dual: list[np.ndarray] = []
    has_dual = False
    row_idx = 0
    for slot_idx, slot in enumerate(bank._slots):  # noqa: SLF001 (internal storage by design)
        for e in slot:
            meta_entries.append(
                {
                    "row": int(row_idx),
                    "slot": int(slot_idx),
                    "md5_tag": str(e.md5_tag),
                    "information_mark": str(e.information_mark.value),
                    "text": str(e.text),
                    "has_dual": e.embedding_dual is not None,
                }
            )
            embs.append(e.embedding.detach().cpu().to(dtype=torch.float32).numpy())
            if e.embedding_dual is not None:
                embs_dual.append(e.embedding_dual.detach().cpu().to(dtype=torch.float32).numpy())
                has_dual = True
            else:
                embs_dual.append(np.zeros((int(bank.dim),), dtype=np.float32))
            row_idx += 1

    emb_arr = np.stack(embs, axis=0) if embs else np.zeros((0, int(bank.dim)), dtype=np.float32)
    np.save(out_dir / f"{name}_embeddings.npy", emb_arr)
    
    if has_dual:
        emb_dual_arr = np.stack(embs_dual, axis=0) if embs_dual else np.zeros((0, int(bank.dim)), dtype=np.float32)
        np.save(out_dir / f"{name}_embeddings_dual.npy", emb_dual_arr)
    
    (out_dir / f"{name}_entries.jsonl").write_text(
        "\n".join([json.dumps(x, ensure_ascii=False) for x in meta_entries]) + ("\n" if meta_entries else ""),
        encoding="utf-8",
    )


def _load_bank(
    *,
    out_dir: Path,
    name: str,
    n_clusters: int,
    dim: int,
    depth: int,
    seed: int,
) -> TextFractalMemoryBank:
    bank = TextFractalMemoryBank(n_clusters=int(n_clusters), dim=int(dim), depth=int(depth), seed=int(seed))
    emb_path = out_dir / f"{name}_embeddings.npy"
    emb_dual_path = out_dir / f"{name}_embeddings_dual.npy"
    entries_path = out_dir / f"{name}_entries.jsonl"
    if not emb_path.exists() or not entries_path.exists():
        raise FileNotFoundError(f"Missing bank files for {name!r} under {out_dir.as_posix()}")

    emb_arr = np.load(emb_path)
    if emb_arr.ndim != 2 or int(emb_arr.shape[1]) != int(dim):
        raise ValueError(f"{emb_path.as_posix()}: expected embeddings shape (N,{dim}), got {tuple(emb_arr.shape)}")

    emb_dual_arr = None
    if emb_dual_path.exists():
        emb_dual_arr = np.load(emb_dual_path)
        if emb_dual_arr.ndim != 2 or int(emb_dual_arr.shape[1]) != int(dim):
            raise ValueError(f"{emb_dual_path.as_posix()}: expected dual embeddings shape (N,{dim}), got {tuple(emb_dual_arr.shape)}")

    lines = entries_path.read_text(encoding="utf-8").splitlines()
    for raw in lines:
        if not raw.strip():
            continue
        rec = json.loads(raw)
        if not isinstance(rec, dict):
            continue
        row = int(rec["row"])
        slot = int(rec["slot"])
        md5_tag = str(rec["md5_tag"])
        mark = InformationMark.parse(rec.get("information_mark"))
        text = str(rec["text"])
        has_dual = rec.get("has_dual", False)
        if row < 0 or row >= int(emb_arr.shape[0]):
            raise ValueError(f"{entries_path.as_posix()}: invalid row index {row}")
        emb = torch.from_numpy(emb_arr[row]).to(dtype=torch.float32, device="cpu")
        emb_dual = None
        if has_dual and emb_dual_arr is not None:
            emb_dual = torch.from_numpy(emb_dual_arr[row]).to(dtype=torch.float32, device="cpu")
        entry = TextMemoryEntry(md5_tag=md5_tag, information_mark=mark, text=text, embedding=emb, embedding_dual=emb_dual)
        bank._add_loaded(entry=entry, slot_idx=int(slot))  # noqa: SLF001 (internal API)
    return bank


def save_lattice_banks(*, bank: LatticeMemoryBank, out_dir: str, meta: dict[str, Any]) -> str:
    """Save lattice memory banks to disk.
    
    Args:
        bank: Lattice memory bank instance
        out_dir: Output directory
        meta: Metadata dictionary
    
    Returns:
        Path to saved directory
    """
    if not _LATTICE_AVAILABLE:
        raise ImportError("Lattice support not available.")
    
    od = Path(out_dir)
    od.mkdir(parents=True, exist_ok=True)
    (od / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    
    # Save lattice bank
    lattice_path = od / "lattice_storage.pkl"
    bank.save(lattice_path)
    
    return od.as_posix()


def load_lattice_banks(*, out_dir: str) -> tuple[LatticeMemoryBank, dict[str, Any]]:
    """Load lattice memory banks from disk.
    
    Args:
        out_dir: Input directory
    
    Returns:
        Tuple of (lattice bank, metadata)
    """
    if not _LATTICE_AVAILABLE:
        raise ImportError("Lattice support not available.")
    
    od = Path(out_dir)
    meta_path = od / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"Missing meta.json: {meta_path.as_posix()}")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    
    # Load lattice bank
    lattice_path = od / "lattice_storage.pkl"
    if not lattice_path.exists():
        raise FileNotFoundError(f"Missing lattice_storage.pkl: {lattice_path.as_posix()}")
    
    cfg = meta.get("bank_config", {})
    bank = LatticeMemoryBank(
        n_levels=int(cfg.get("n_levels", 8)),
        n_per_level=int(cfg.get("n_per_level", 512)),
        dim=int(cfg.get("dim", 8)),
        seed=int(cfg.get("seed", 1234)),
        storage_path=lattice_path,
    )
    
    return bank, meta


def save_text_memory_banks(*, banks: TextFractalMemoryBanks, out_dir: str, meta: dict[str, Any]) -> str:
    """
    Persist TextFractalMemoryBanks for fast reloads.

    Format:
      <out_dir>/meta.json
      <out_dir>/verified_embeddings.npy
      <out_dir>/verified_entries.jsonl
      <out_dir>/quarantine_embeddings.npy
      <out_dir>/quarantine_entries.jsonl
    """

    od = Path(out_dir)
    _ensure_dir(od)
    (od / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    _save_bank(bank=banks.verified, out_dir=od, name="verified")
    _save_bank(bank=banks.quarantine, out_dir=od, name="quarantine")
    return od.as_posix()


def load_text_memory_banks(*, out_dir: str) -> tuple[TextFractalMemoryBanks, dict[str, Any]]:
    od = Path(out_dir)
    meta_path = od / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"Missing meta.json: {meta_path.as_posix()}")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if not isinstance(meta, dict):
        raise TypeError("meta.json must contain a JSON object")

    cfg = meta.get("bank_config", {})
    if not isinstance(cfg, dict):
        raise TypeError("meta['bank_config'] must be a JSON object")

    n_clusters = int(cfg["n_clusters"])
    dim = int(cfg["dim"])
    depth = int(cfg["depth"])
    seed = int(cfg["seed"])
    allow_quarantine_read = bool(cfg.get("allow_quarantine_read", False))

    verified = _load_bank(out_dir=od, name="verified", n_clusters=n_clusters, dim=dim, depth=depth, seed=seed)
    quarantine = _load_bank(out_dir=od, name="quarantine", n_clusters=n_clusters, dim=dim, depth=depth, seed=seed)
    banks = TextFractalMemoryBanks(verified=verified, quarantine=quarantine, allow_quarantine_read=allow_quarantine_read)
    return banks, meta

