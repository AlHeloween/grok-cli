"""Suite-level teacher metrics and promotion gating utilities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class ConfusionMatrix:
    """Confusion matrix for binary classification (promote vs don't promote)."""
    tp: int  # True positives: predicted promote, actually correct
    fp: int  # False positives: predicted promote, actually incorrect
    tn: int  # True negatives: predicted don't promote, actually incorrect
    fn: int  # False negatives: predicted don't promote, actually correct
    
    @property
    def total(self) -> int:
        """Total number of predictions."""
        return self.tp + self.fp + self.tn + self.fn
    
    @property
    def precision(self) -> float:
        """Precision: TP / (TP + FP)."""
        denom = self.tp + self.fp
        return float(self.tp) / denom if denom > 0 else 0.0
    
    @property
    def recall(self) -> float:
        """Recall: TP / (TP + FN)."""
        denom = self.tp + self.fn
        return float(self.tp) / denom if denom > 0 else 0.0
    
    @property
    def f1_score(self) -> float:
        """F1 score: 2 * (precision * recall) / (precision + recall)."""
        p = self.precision
        r = self.recall
        denom = p + r
        return 2.0 * (p * r) / denom if denom > 0 else 0.0
    
    @property
    def accuracy(self) -> float:
        """Accuracy: (TP + TN) / total."""
        return float(self.tp + self.tn) / self.total if self.total > 0 else 0.0
    
    def as_dict(self) -> Dict[str, float]:
        """Convert to dictionary."""
        return {
            "tp": int(self.tp),
            "fp": int(self.fp),
            "tn": int(self.tn),
            "fn": int(self.fn),
            "total": int(self.total),
            "precision": float(self.precision),
            "recall": float(self.recall),
            "f1_score": float(self.f1_score),
            "accuracy": float(self.accuracy),
        }


@dataclass(frozen=True)
class PromotionDecision:
    """Record of a promotion decision."""
    index: int
    match_rate: float
    total_observations: int
    promoted: bool
    reason: str  # Why promoted or not promoted


@dataclass(frozen=True)
class SuiteMetrics:
    """Aggregated suite-level teacher metrics."""
    confusion_matrix: ConfusionMatrix
    promoted_indices: List[int]
    blocked_indices: List[int]
    promotion_decisions: List[PromotionDecision]
    train_events: int
    test_events: int
    eligible_indices: int
    promote_threshold: float
    promote_min_count: int
    
    def as_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "confusion_matrix": self.confusion_matrix.as_dict(),
            "promoted_indices": self.promoted_indices[:512],  # Limit for JSON size
            "blocked_indices": self.blocked_indices[:512],
            "promotion_decisions": [
                {
                    "index": int(d.index),
                    "match_rate": float(d.match_rate),
                    "total_observations": int(d.total_observations),
                    "promoted": bool(d.promoted),
                    "reason": str(d.reason),
                }
                for d in self.promotion_decisions[:100]  # Limit for JSON size
            ],
            "train_events": int(self.train_events),
            "test_events": int(self.test_events),
            "eligible_indices": int(self.eligible_indices),
            "promote_threshold": float(self.promote_threshold),
            "promote_min_count": int(self.promote_min_count),
        }


def compute_suite_metrics(
    *,
    train_events: Sequence[Dict],
    test_events: Sequence[Dict],
    promote_threshold: float,
    promote_min_count: int,
) -> SuiteMetrics:
    """
    Compute suite-level metrics from train/test events.
    
    Args:
        train_events: List of training events, each with "idx" and "match" keys
        test_events: List of test events, each with "idx" and "match" keys
        promote_threshold: Minimum match rate to promote (e.g., 0.95)
        promote_min_count: Minimum observations to be eligible for promotion
    
    Returns:
        SuiteMetrics with confusion matrix and promotion decisions
    """
    # Aggregate training events by index
    per_idx: Dict[int, Dict[str, int]] = {}
    for e in train_events:
        idx = int(e["idx"])
        d = per_idx.setdefault(idx, {"total": 0, "match": 0})
        d["total"] += 1
        d["match"] += int(bool(e.get("match", False)))
    
    # Determine safe set (indices to promote)
    safe_set = set()
    promotion_decisions: List[PromotionDecision] = []
    
    for idx, d in per_idx.items():
        total = d["total"]
        match = d["match"]
        rate = match / max(1, total)
        
        if total < promote_min_count:
            reason = f"insufficient_observations ({total} < {promote_min_count})"
            promoted = False
        elif rate >= promote_threshold:
            reason = f"match_rate_above_threshold ({rate:.3f} >= {promote_threshold})"
            promoted = True
            safe_set.add(idx)
        else:
            reason = f"match_rate_below_threshold ({rate:.3f} < {promote_threshold})"
            promoted = False
        
        promotion_decisions.append(
            PromotionDecision(
                index=idx,
                match_rate=rate,
                total_observations=total,
                promoted=promoted,
                reason=reason,
            )
        )
    
    # Compute confusion matrix on test set
    tp = fp = tn = fn = 0
    for e in test_events:
        idx = int(e["idx"])
        pred = idx in safe_set
        truth = bool(e.get("match", False))
        
        tp += int(pred and truth)
        fp += int(pred and (not truth))
        tn += int((not pred) and (not truth))
        fn += int((not pred) and truth)
    
    confusion_matrix = ConfusionMatrix(tp=tp, fp=fp, tn=tn, fn=fn)
    
    # Separate promoted and blocked indices
    promoted_indices = sorted(safe_set)
    blocked_indices = sorted(set(per_idx.keys()) - safe_set)
    
    return SuiteMetrics(
        confusion_matrix=confusion_matrix,
        promoted_indices=promoted_indices,
        blocked_indices=blocked_indices,
        promotion_decisions=promotion_decisions,
        train_events=len(train_events),
        test_events=len(test_events),
        eligible_indices=len(per_idx),
        promote_threshold=promote_threshold,
        promote_min_count=promote_min_count,
    )


def compute_token_match_rate(
    baseline_tokens: Sequence[int],
    generated_tokens: Sequence[int],
) -> float:
    """
    Compute token-level match rate between baseline and generated sequences.
    
    Args:
        baseline_tokens: Baseline token sequence
        generated_tokens: Generated token sequence
    
    Returns:
        Match rate (0.0 to 1.0)
    """
    if not baseline_tokens or not generated_tokens:
        return 0.0
    
    n = min(len(baseline_tokens), len(generated_tokens))
    if n == 0:
        return 0.0
    
    matches = sum(1 for i in range(n) if baseline_tokens[i] == generated_tokens[i])
    return float(matches) / float(n)


def compute_structured_match(
    baseline_answer: str,
    generated_answer: str,
    match_mode: str = "exact",
) -> bool:
    """
    Compute structured answer match (exact, regex, or JSON).
    
    Args:
        baseline_answer: Baseline answer string
        generated_answer: Generated answer string
        match_mode: "exact", "regex", or "json"
    
    Returns:
        True if answers match according to mode
    """
    if match_mode == "exact":
        return baseline_answer.strip() == generated_answer.strip()
    elif match_mode == "regex":
        import re
        try:
            pattern = re.compile(baseline_answer.strip())
            return bool(pattern.match(generated_answer.strip()))
        except re.error:
            return False
    elif match_mode == "json":
        import json
        try:
            baseline_obj = json.loads(baseline_answer.strip())
            generated_obj = json.loads(generated_answer.strip())
            return baseline_obj == generated_obj
        except (json.JSONDecodeError, ValueError):
            return False
    else:
        raise ValueError(f"Unknown match_mode: {match_mode}")
