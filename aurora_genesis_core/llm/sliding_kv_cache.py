from __future__ import annotations

from typing import Any, Optional, Sequence, Tuple

import torch


PastKeyValues = Sequence[Any]


def _slice_seq_dim(x: torch.Tensor, *, seq_dim: int, max_len: int) -> torch.Tensor:
    if x.ndim < 1:
        raise ValueError("Expected tensor with at least 1 dim.")
    seq_dim = int(seq_dim)
    max_len = int(max_len)
    if max_len < 1:
        raise ValueError(f"max_len must be >= 1, got {max_len}")

    seq_len = int(x.shape[seq_dim])
    if seq_len <= max_len:
        return x
    start = seq_len - max_len
    idx = [slice(None)] * x.ndim
    idx[seq_dim] = slice(start, seq_len)
    return x[tuple(idx)]


def _infer_seq_dim(k: torch.Tensor, v: torch.Tensor) -> int:
    """
    Try to infer which dim is the sequence length in common cache layouts.

    Supported heuristics:
    - (B, H, T, D): seq_dim = -2
    - (B, T, H, D): seq_dim = -3
    """

    if k.ndim != v.ndim:
        raise ValueError(f"k/v ndims mismatch: {k.ndim} vs {v.ndim}")
    if k.ndim < 3:
        raise ValueError(f"Unexpected cache ndim={k.ndim} (need >=3).")

    candidates: list[tuple[int, int]] = []

    # Common: (B, H, T, D) -> seq_dim = -2
    if k.shape[-2] == v.shape[-2]:
        candidates.append((-2, int(k.shape[-2])))
    # Alternate: (B, T, H, D) -> seq_dim = -3
    if k.ndim >= 3 and k.shape[-3] == v.shape[-3]:
        candidates.append((-3, int(k.shape[-3])))

    if candidates:
        # Prefer the dimension that looks like a "sequence length" (usually the larger one).
        candidates.sort(key=lambda x: x[1], reverse=True)
        return int(candidates[0][0])

    raise ValueError(f"Unable to infer seq dim for k={tuple(k.shape)} v={tuple(v.shape)}")


def trim_past_key_values(past: Optional[PastKeyValues], *, max_len: int) -> Optional[Tuple[Any, ...]]:
    """
    Trim HF/Transformers-style `past_key_values` to keep only the last `max_len` tokens.

    This enables a fixed attention/KV window during streaming and decoding.
    """

    if past is None:
        return None
    max_len = int(max_len)
    if max_len < 1:
        raise ValueError(f"max_len must be >= 1, got {max_len}")

    out: list[Any] = []
    for layer in past:
        # Common shapes:
        # - tuple(k, v)
        # - tuple(k, v, ...) (some models include additional tensors)
        if not isinstance(layer, (tuple, list)) or len(layer) < 2:
            raise TypeError(f"Unsupported past layer type: {type(layer)}")
        k = layer[0]
        v = layer[1]
        if not isinstance(k, torch.Tensor) or not isinstance(v, torch.Tensor):
            raise TypeError("Expected k/v tensors in past_key_values.")

        seq_dim = _infer_seq_dim(k, v)
        k2 = _slice_seq_dim(k, seq_dim=seq_dim, max_len=max_len)
        v2 = _slice_seq_dim(v, seq_dim=seq_dim, max_len=max_len)

        if len(layer) == 2:
            out.append((k2, v2))
        else:
            out.append((k2, v2, *layer[2:]))
    return tuple(out)
