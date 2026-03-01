from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

import torch

from .dataset import TKGExample


@dataclass(frozen=True)
class TKGFilteredMetrics:
    mrr: float
    hits_1: float
    hits_3: float
    hits_10: float
    mean_rank: float
    n: int

    def as_dict(self) -> Dict[str, float]:
        return {
            "mrr": float(self.mrr),
            "hits@1": float(self.hits_1),
            "hits@3": float(self.hits_3),
            "hits@10": float(self.hits_10),
            "mean_rank": float(self.mean_rank),
            "n": int(self.n),
        }


def build_tail_filter(examples: Iterable[TKGExample]) -> Dict[Tuple[int, int, int], Set[int]]:
    filt: Dict[Tuple[int, int, int], Set[int]] = {}
    for ex in examples:
        key = (ex.s, ex.r, ex.t)
        s = filt.get(key)
        if s is None:
            s = set()
            filt[key] = s
        s.add(ex.o)
    return filt


def _rank_from_scores(scores: torch.Tensor, target_index: int) -> int:
    if scores.dim() != 1:
        raise ValueError(f"scores must be 1D (n_entities,), got shape={tuple(scores.shape)}")
    target_score = scores[target_index].item()
    better = int(torch.sum(scores > target_score).item())
    return better + 1


@torch.no_grad()
def tkg_filtered_metrics(
    *,
    model: torch.nn.Module,
    eval_examples: Sequence[TKGExample],
    all_examples_for_filtering: Sequence[TKGExample],
    n_entities: int,
    device: Optional[str] = None,
    batch_size: int = 16,
) -> TKGFilteredMetrics:
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    model = model.to(device).eval()
    filt = build_tail_filter(all_examples_for_filtering)

    ranks: List[int] = []
    for start in range(0, len(eval_examples), batch_size):
        batch = eval_examples[start : start + batch_size]
        s = torch.tensor([x.s for x in batch], device=device, dtype=torch.long)
        r = torch.tensor([x.r for x in batch], device=device, dtype=torch.long)
        t = torch.tensor([x.t for x in batch], device=device, dtype=torch.long)
        tau = torch.tensor([x.tau for x in batch], device=device, dtype=torch.float32)
        o = torch.tensor([x.o for x in batch], device=device, dtype=torch.long)

        scores = model.score_all_tails(s=s, r=r, t=t, tau=tau, n_entities=n_entities)  # (B, E)
        if scores.shape != (len(batch), n_entities):
            raise ValueError(f"model returned scores with shape {tuple(scores.shape)}; expected {(len(batch), n_entities)}")

        for i, ex in enumerate(batch):
            row = scores[i].clone()
            key = (ex.s, ex.r, ex.t)
            blocked = filt.get(key, set())
            if blocked:
                idx = torch.tensor(sorted(blocked), device=device, dtype=torch.long)
                row[idx] = float("-inf")
            row[ex.o] = scores[i, ex.o]
            ranks.append(_rank_from_scores(row, int(ex.o)))

    n = len(ranks)
    if n == 0:
        raise ValueError("No evaluation examples.")

    r = torch.tensor(ranks, dtype=torch.float32)
    mrr = torch.mean(1.0 / r).item()
    mean_rank = torch.mean(r).item()
    hits_1 = torch.mean((r <= 1).to(torch.float32)).item()
    hits_3 = torch.mean((r <= 3).to(torch.float32)).item()
    hits_10 = torch.mean((r <= 10).to(torch.float32)).item()
    return TKGFilteredMetrics(mrr=mrr, hits_1=hits_1, hits_3=hits_3, hits_10=hits_10, mean_rank=mean_rank, n=n)

