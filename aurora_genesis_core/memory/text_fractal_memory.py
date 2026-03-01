from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Iterable, Optional

import torch

from aurora_genesis_core.fractal.sierpinski import generate_sierpinski_centroids
from deepseek_adapter.adid_memory import InformationMark

# Optional FFE/lattice support
try:
    from aurora_genesis_core.memory.ffe_quantization import FFEQuantizer, FFEAddress
    from aurora_genesis_core.memory.lattice_addressing import SierpinskiLatticeAddress
    from aurora_genesis_core.memory.lattice_memory_bank import LatticeMemoryBank
    _FFE_AVAILABLE = True
except ImportError:
    _FFE_AVAILABLE = False
    FFEQuantizer = None  # type: ignore
    FFEAddress = None  # type: ignore
    SierpinskiLatticeAddress = None  # type: ignore
    LatticeMemoryBank = None  # type: ignore


def _md5_hex(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _hash_embed(*, text: str, dim: int, seed: int) -> torch.Tensor:
    if dim < 1:
        raise ValueError(f"dim must be >= 1, got {dim}")
    tokens = re.findall(r"[A-Za-z0-9_]+", text)
    if not tokens:
        tokens = [text.strip() or "<empty>"]

    n_hashes_per_token = 4

    vec = torch.zeros((dim,), dtype=torch.float32, device="cpu")
    for token in tokens:
        h = hashlib.md5(f"{seed}:{token}".encode("utf-8")).digest()  # 16 bytes
        for j in range(n_hashes_per_token):
            off = (j * 4) % 16
            idx = int.from_bytes(h[off : off + 4], "little", signed=False) % dim
            sign = -1.0 if (h[(off + 1) % 16] & 1) else 1.0
            vec[idx] += sign
    norm = float(vec.norm(p=2).item())
    if norm > 0:
        vec /= norm
    return vec


@dataclass(frozen=True)
class TextMemoryEntry:
    md5_tag: str
    information_mark: InformationMark
    text: str
    embedding: torch.Tensor  # (dim,) float32 CPU - primal component
    embedding_dual: Optional[torch.Tensor] = None  # (dim,) float32 CPU - dual component (optional)


class TextFractalMemoryBank:
    """
    A lightweight, deterministic "fractal memory" for **text entries**.

    This is intended for Phase-5 long-context benchmarking (compute reduction) where
    we want retrieval to replace long-context attention, without requiring a trained
    latent-memory path yet.
    """

    def __init__(
        self,
        *,
        n_clusters: int,
        dim: int,
        depth: int,
        seed: int = 1234,
    ) -> None:
        if n_clusters < 1:
            raise ValueError(f"n_clusters must be >= 1, got {n_clusters}")
        if dim < 1:
            raise ValueError(f"dim must be >= 1, got {dim}")
        if depth < 1:
            raise ValueError(f"depth must be >= 1, got {depth}")

        self.dim = int(dim)
        self.seed = int(seed)

        self._centroids = generate_sierpinski_centroids(
            n_dim=int(dim),
            depth=int(depth),
            n_centroids=int(n_clusters),
            seed=int(seed),
            device="cpu",
        ).to(dtype=torch.float32, device="cpu")
        if self._centroids.ndim != 2 or self._centroids.shape[1] != dim:
            raise ValueError(f"Unexpected centroid shape: {tuple(self._centroids.shape)}")

        self._slots: list[list[TextMemoryEntry]] = [[] for _ in range(int(n_clusters))]
        self._slot_mats: list[Optional[torch.Tensor]] = [None for _ in range(int(n_clusters))]
        self._seen_md5: set[str] = set()
        
        # FFE/lattice support (optional)
        self._use_ffe = False
        self._ffe_quantizer: Optional[FFEQuantizer] = None
        self._lattice_bank: Optional[LatticeMemoryBank] = None

    def __len__(self) -> int:
        return len(self._seen_md5)
    
    def enable_ffe_mode(
        self,
        n_levels: int = 8,
        n_per_level: int = 512,
        seed: Optional[int] = None,
    ) -> None:
        """Enable FFE/lattice mode for this memory bank.
        
        Args:
            n_levels: Number of hierarchical levels
            n_per_level: Number of centroids per level
            seed: Random seed (uses self.seed if None)
        """
        if not _FFE_AVAILABLE:
            raise ImportError("FFE/lattice support not available. Install required dependencies.")
        
        ffe_seed = seed if seed is not None else self.seed
        self._ffe_quantizer = FFEQuantizer(
            n_levels=n_levels,
            n_per_level=n_per_level,
            dim=self.dim,
            seed=ffe_seed,
        )
        self._use_ffe = True

    def _add_loaded(self, *, entry: TextMemoryEntry, slot_idx: int) -> None:
        if not isinstance(entry, TextMemoryEntry):
            raise TypeError("entry must be a TextMemoryEntry")
        if int(slot_idx) < 0 or int(slot_idx) >= len(self._slots):
            raise ValueError(f"slot_idx out of range: {slot_idx}")
        if entry.embedding.ndim != 1 or int(entry.embedding.shape[0]) != int(self.dim):
            raise ValueError(f"entry.embedding must be (dim,), got {tuple(entry.embedding.shape)}")
        if entry.md5_tag in self._seen_md5:
            return
        self._slots[int(slot_idx)].append(entry)
        self._slot_mats[int(slot_idx)] = None
        self._seen_md5.add(entry.md5_tag)

    def add(
        self,
        *,
        text: str,
        information_mark: InformationMark,
        embed_text: Optional[str] = None,
        embedding_dual: Optional[torch.Tensor] = None,
        md5_tag: Optional[str] = None,
    ) -> bool:
        clean = text.strip()
        if not clean:
            raise ValueError("text must be non-empty")
        tag = md5_tag or _md5_hex(clean)
        if tag in self._seen_md5:
            return False
        embed_source = str(embed_text).strip() if embed_text is not None else clean
        if not embed_source:
            raise ValueError("embed_text must be non-empty when provided")
        emb = _hash_embed(text=embed_source, dim=self.dim, seed=self.seed)
        slot = int(self._nearest_centroid_idx(emb))
        entry = TextMemoryEntry(
            md5_tag=tag,
            information_mark=information_mark,
            text=clean,
            embedding=emb,
            embedding_dual=embedding_dual
        )
        self._slots[slot].append(entry)
        self._slot_mats[slot] = None
        self._seen_md5.add(tag)
        return True

    def query(
        self,
        *,
        text: str,
        candidate_slots: int = 4,
        top_k: int = 4,
        query_dual: Optional[torch.Tensor] = None,
        dual_weight: float = 0.1,
    ) -> list[TextMemoryEntry]:
        if candidate_slots < 1:
            raise ValueError(f"candidate_slots must be >= 1, got {candidate_slots}")
        if top_k < 1:
            raise ValueError(f"top_k must be >= 1, got {top_k}")
        q = _hash_embed(text=text, dim=self.dim, seed=self.seed)
        idxs = self._nearest_centroid_idxs(q, k=candidate_slots)
        mats: list[torch.Tensor] = []
        mats_dual: list[torch.Tensor] = []
        entries: list[TextMemoryEntry] = []
        for ii in idxs:
            slot_idx = int(ii)
            slot_entries = self._slots[slot_idx]
            if not slot_entries:
                continue
            mat = self._slot_mats[slot_idx]
            if mat is None:
                mat = torch.stack([e.embedding for e in slot_entries], dim=0).to(dtype=torch.float32, device="cpu")
                self._slot_mats[slot_idx] = mat
            mats.append(mat)
            # Collect dual embeddings if available
            if query_dual is not None:
                mat_dual = torch.stack([
                    e.embedding_dual if e.embedding_dual is not None else torch.zeros_like(e.embedding)
                    for e in slot_entries
                ], dim=0).to(dtype=torch.float32, device="cpu")
                mats_dual.append(mat_dual)
            entries.extend(slot_entries)
        if not entries:
            return []

        all_mat = mats[0] if len(mats) == 1 else torch.cat(mats, dim=0)
        
        # Compute primal similarity
        sims = all_mat @ q.to(dtype=torch.float32, device="cpu")
        
        # Add dual similarity if available
        if query_dual is not None and mats_dual:
            all_mat_dual = mats_dual[0] if len(mats_dual) == 1 else torch.cat(mats_dual, dim=0)
            sims_dual = all_mat_dual @ query_dual.to(dtype=torch.float32, device="cpu")
            sims = sims + dual_weight * sims_dual
        
        k = min(int(top_k), int(sims.numel()))
        vals, idxs2 = torch.topk(sims, k=k, largest=True)
        _ = vals
        return [entries[int(i.item())] for i in idxs2]

    def stats(self) -> dict[str, int]:
        non_empty = sum(1 for s in self._slots if len(s) > 0)
        return {"entries": len(self), "slots_total": len(self._slots), "slots_non_empty": int(non_empty)}

    def _nearest_centroid_idx(self, emb: torch.Tensor) -> int:
        if emb.ndim != 1 or emb.shape[0] != self.dim:
            raise ValueError(f"emb must be (dim,), got {tuple(emb.shape)}")
        d2 = ((self._centroids - emb.unsqueeze(0)) ** 2).sum(dim=1)
        return int(torch.argmin(d2).item())

    def _nearest_centroid_idxs(self, emb: torch.Tensor, *, k: int) -> list[int]:
        if k < 1:
            raise ValueError(f"k must be >= 1, got {k}")
        d2 = ((self._centroids - emb.unsqueeze(0)) ** 2).sum(dim=1)
        kk = min(int(k), int(d2.numel()))
        vals, idxs = torch.topk(d2, k=kk, largest=False)
        _ = vals  # silence unused-var linters without adding comments elsewhere
        return [int(i.item()) for i in idxs]


class TextFractalMemoryBanks:
    def __init__(
        self,
        *,
        verified: TextFractalMemoryBank,
        quarantine: TextFractalMemoryBank,
        allow_quarantine_read: bool = False,
    ) -> None:
        self.verified = verified
        self.quarantine = quarantine
        self.allow_quarantine_read = bool(allow_quarantine_read)

    def add(
        self,
        *,
        text: str,
        information_mark: InformationMark,
        embed_text: Optional[str] = None,
        md5_tag: Optional[str] = None,
    ) -> bool:
        if information_mark in (InformationMark.EXACT, InformationMark.INFERRED):
            return self.verified.add(
                text=text,
                information_mark=information_mark,
                embed_text=embed_text,
                md5_tag=md5_tag,
            )
        return self.quarantine.add(text=text, information_mark=information_mark, embed_text=embed_text, md5_tag=md5_tag)

    def query(
        self,
        *,
        text: str,
        candidate_slots: int = 4,
        top_k: int = 4,
    ) -> list[TextMemoryEntry]:
        out = list(self.verified.query(text=text, candidate_slots=candidate_slots, top_k=top_k))
        if self.allow_quarantine_read and len(out) < top_k:
            rem = int(top_k) - len(out)
            out.extend(self.quarantine.query(text=text, candidate_slots=candidate_slots, top_k=rem))
        return out[: int(top_k)]

    def stats(self) -> dict[str, dict[str, int]]:
        return {"verified": self.verified.stats(), "quarantine": self.quarantine.stats()}


def build_text_memory_banks(
    *,
    n_clusters: int,
    dim: int,
    depth: int,
    seed: int = 1234,
    allow_quarantine_read: bool = False,
) -> TextFractalMemoryBanks:
    verified = TextFractalMemoryBank(n_clusters=n_clusters, dim=dim, depth=depth, seed=seed)
    quarantine = TextFractalMemoryBank(n_clusters=n_clusters, dim=dim, depth=depth, seed=seed)
    return TextFractalMemoryBanks(verified=verified, quarantine=quarantine, allow_quarantine_read=allow_quarantine_read)


def format_memory_injection(entries: Iterable[TextMemoryEntry]) -> str:
    lines = ["<memory>"]
    for e in entries:
        lines.append(e.text)
    lines.append("</memory>")
    return "\n".join(lines) + "\n"


def format_memory_injection_lines(lines: Iterable[str]) -> str:
    out = ["<memory>"]
    for line in lines:
        clean = str(line).strip()
        if clean:
            out.append(clean)
    out.append("</memory>")
    return "\n".join(out) + "\n"
