from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np


@dataclass(frozen=True)
class TKGExample:
    s: int
    r: int
    o: int
    t: int
    tau: float  # normalized time scalar in [0, 1]


def _parse_time_scalar(raw: str) -> float:
    s = str(raw).strip()
    if not s:
        raise ValueError("Empty time value.")
    if s.isdigit():
        return float(int(s))
    s_norm = s[:-1] if s.endswith("Z") else s
    try:
        dt = datetime.fromisoformat(s_norm)
    except ValueError as e:
        raise ValueError(f"Unsupported time format: {s!r} (expected int or ISO8601).") from e
    return float(dt.timestamp())


def load_tkg_tsv(path: str, *, delimiter: str = "\t") -> List[Tuple[str, str, str, str]]:
    p = Path(path)
    rows: List[Tuple[str, str, str, str]] = []
    for line_no, raw in enumerate(p.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [x.strip() for x in line.split(delimiter)]
        if len(parts) != 4:
            raise ValueError(f"{p.as_posix()}:{line_no}: expected 4 columns (s,r,o,t); got {len(parts)}")
        s, r, o, t = parts
        rows.append((s, r, o, t))
    if not rows:
        raise ValueError(f"{p.as_posix()}: no data rows found.")
    return rows


def _build_vocab(values: Iterable[str]) -> Dict[str, int]:
    uniq = sorted(set(str(v) for v in values))
    return {k: i for i, k in enumerate(uniq)}


def _minmax(xs: Sequence[float]) -> Tuple[float, float]:
    if not xs:
        raise ValueError("Cannot minmax an empty list.")
    mn = min(xs)
    mx = max(xs)
    return mn, mx


class TKGDataset:
    def __init__(
        self,
        *,
        examples: Sequence[TKGExample],
        entity_to_id: Dict[str, int],
        relation_to_id: Dict[str, int],
        time_to_id: Dict[str, int],
    ) -> None:
        self.examples = list(examples)
        self.entity_to_id = dict(entity_to_id)
        self.relation_to_id = dict(relation_to_id)
        self.time_to_id = dict(time_to_id)

    @property
    def n_entities(self) -> int:
        return len(self.entity_to_id)

    @property
    def n_relations(self) -> int:
        return len(self.relation_to_id)

    @property
    def n_times(self) -> int:
        return len(self.time_to_id)

    @classmethod
    def from_rows(
        cls,
        rows: Sequence[Tuple[str, str, str, str]],
        *,
        normalize_time: bool = True,
    ) -> "TKGDataset":
        entities = [s for s, _, _, _ in rows] + [o for _, _, o, _ in rows]
        relations = [r for _, r, _, _ in rows]
        times_raw = [t for *_, t in rows]

        entity_to_id = _build_vocab(entities)
        relation_to_id = _build_vocab(relations)
        time_to_id = _build_vocab(times_raw)

        time_values = [_parse_time_scalar(t) for t in times_raw]
        if normalize_time:
            mn, mx = _minmax(time_values)
            span = mx - mn
            if span <= 0:
                taus = [0.0 for _ in time_values]
            else:
                taus = [(x - mn) / span for x in time_values]
        else:
            taus = list(time_values)

        examples: List[TKGExample] = []
        for (s, r, o, t), tau in zip(rows, taus):
            examples.append(
                TKGExample(
                    s=entity_to_id[s],
                    r=relation_to_id[r],
                    o=entity_to_id[o],
                    t=time_to_id[t],
                    tau=float(tau),
                )
            )
        return cls(examples=examples, entity_to_id=entity_to_id, relation_to_id=relation_to_id, time_to_id=time_to_id)

    @classmethod
    def from_tsv(cls, path: str, *, delimiter: str = "\t") -> "TKGDataset":
        return cls.from_rows(load_tkg_tsv(path, delimiter=delimiter))

    @staticmethod
    def _encode_rows_with_vocab(
        rows: Sequence[Tuple[str, str, str, str]],
        *,
        entity_to_id: Dict[str, int],
        relation_to_id: Dict[str, int],
        time_to_id: Dict[str, int],
        time_min: float,
        time_max: float,
    ) -> List[TKGExample]:
        span = time_max - time_min
        examples: List[TKGExample] = []
        for s, r, o, t in rows:
            if s not in entity_to_id:
                raise KeyError(f"Unknown entity: {s!r}")
            if o not in entity_to_id:
                raise KeyError(f"Unknown entity: {o!r}")
            if r not in relation_to_id:
                raise KeyError(f"Unknown relation: {r!r}")
            if t not in time_to_id:
                raise KeyError(f"Unknown time token: {t!r}")
            tv = _parse_time_scalar(t)
            tau = 0.0 if span <= 0 else (tv - time_min) / span
            examples.append(
                TKGExample(
                    s=entity_to_id[s],
                    r=relation_to_id[r],
                    o=entity_to_id[o],
                    t=time_to_id[t],
                    tau=float(tau),
                )
            )
        return examples

    @classmethod
    def from_split_tsv(
        cls,
        *,
        train_path: str,
        valid_path: str,
        test_path: str,
        delimiter: str = "\t",
    ) -> Tuple["TKGDataset", "TKGDataset", "TKGDataset"]:
        train_rows = load_tkg_tsv(train_path, delimiter=delimiter)
        valid_rows = load_tkg_tsv(valid_path, delimiter=delimiter)
        test_rows = load_tkg_tsv(test_path, delimiter=delimiter)
        all_rows = list(train_rows) + list(valid_rows) + list(test_rows)

        entities = [s for s, _, _, _ in all_rows] + [o for _, _, o, _ in all_rows]
        relations = [r for _, r, _, _ in all_rows]
        times_raw = [t for *_, t in all_rows]
        entity_to_id = _build_vocab(entities)
        relation_to_id = _build_vocab(relations)
        time_to_id = _build_vocab(times_raw)

        time_values = [_parse_time_scalar(t) for t in times_raw]
        mn, mx = _minmax(time_values)

        return (
            TKGDataset(
                examples=cls._encode_rows_with_vocab(
                    train_rows,
                    entity_to_id=entity_to_id,
                    relation_to_id=relation_to_id,
                    time_to_id=time_to_id,
                    time_min=mn,
                    time_max=mx,
                ),
                entity_to_id=entity_to_id,
                relation_to_id=relation_to_id,
                time_to_id=time_to_id,
            ),
            TKGDataset(
                examples=cls._encode_rows_with_vocab(
                    valid_rows,
                    entity_to_id=entity_to_id,
                    relation_to_id=relation_to_id,
                    time_to_id=time_to_id,
                    time_min=mn,
                    time_max=mx,
                ),
                entity_to_id=entity_to_id,
                relation_to_id=relation_to_id,
                time_to_id=time_to_id,
            ),
            TKGDataset(
                examples=cls._encode_rows_with_vocab(
                    test_rows,
                    entity_to_id=entity_to_id,
                    relation_to_id=relation_to_id,
                    time_to_id=time_to_id,
                    time_min=mn,
                    time_max=mx,
                ),
                entity_to_id=entity_to_id,
                relation_to_id=relation_to_id,
                time_to_id=time_to_id,
            ),
        )

    def split_by_time(
        self,
        *,
        train_frac: float = 0.8,
        valid_frac: float = 0.1,
    ) -> Tuple["TKGDataset", "TKGDataset", "TKGDataset"]:
        if not (0.0 < train_frac < 1.0):
            raise ValueError("train_frac must be in (0, 1).")
        if not (0.0 <= valid_frac < 1.0):
            raise ValueError("valid_frac must be in [0, 1).")
        if train_frac + valid_frac >= 1.0:
            raise ValueError("train_frac + valid_frac must be < 1.")

        times = sorted({ex.t for ex in self.examples})
        if not times:
            raise ValueError("Dataset has no examples.")

        n = len(times)
        n_train = max(1, int(round(n * train_frac)))
        n_valid = max(0, int(round(n * valid_frac)))
        n_train = min(n_train, n)
        n_valid = min(n_valid, n - n_train)

        train_times = set(times[:n_train])
        valid_times = set(times[n_train : n_train + n_valid])
        test_times = set(times[n_train + n_valid :])

        def keep(ts: set) -> List[TKGExample]:
            return [ex for ex in self.examples if ex.t in ts]

        return (
            TKGDataset(examples=keep(train_times), entity_to_id=self.entity_to_id, relation_to_id=self.relation_to_id, time_to_id=self.time_to_id),
            TKGDataset(examples=keep(valid_times), entity_to_id=self.entity_to_id, relation_to_id=self.relation_to_id, time_to_id=self.time_to_id),
            TKGDataset(examples=keep(test_times), entity_to_id=self.entity_to_id, relation_to_id=self.relation_to_id, time_to_id=self.time_to_id),
        )


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(1024 * 1024)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _find_split_files(dir_path: Path) -> tuple[Path, Path, Path]:
    """
    Detect common TKG split filenames in a directory.

    Supported names (examples):
    - train.tsv / valid.tsv / test.tsv
    - train.txt / valid.txt / test.txt
    - train.txt / dev.txt / test.txt
    """

    if not dir_path.exists():
        raise FileNotFoundError(f"data dir not found: {dir_path.as_posix()}")
    if not dir_path.is_dir():
        raise NotADirectoryError(f"data dir is not a directory: {dir_path.as_posix()}")

    train_candidates = ["train.tsv", "train.txt", "train.csv"]
    valid_candidates = ["valid.tsv", "valid.txt", "valid.csv", "dev.tsv", "dev.txt", "dev.csv"]
    test_candidates = ["test.tsv", "test.txt", "test.csv"]

    def pick(cands: list[str]) -> Path:
        for name in cands:
            p = dir_path / name
            if p.exists():
                return p
        raise FileNotFoundError(f"Missing split file in {dir_path.as_posix()}: tried {cands}")

    return pick(train_candidates), pick(valid_candidates), pick(test_candidates)


def _write_vocab_lines(path: Path, items: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(items) + "\n", encoding="utf-8")


def _read_vocab_lines(path: Path) -> list[str]:
    items = [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines()]
    return [x for x in items if x]


def _build_vocab_list(values: Iterable[str]) -> tuple[list[str], Dict[str, int]]:
    uniq = sorted(set(str(v) for v in values))
    return uniq, {k: i for i, k in enumerate(uniq)}


def load_tkg_splits_from_dir(
    dir_path: str,
    *,
    delimiter: str = "\t",
) -> tuple[TKGDataset, TKGDataset, TKGDataset]:
    """
    Load TKG splits from a directory (train/valid/test) with shared vocab and normalized time.
    """

    train_p, valid_p, test_p = _find_split_files(Path(dir_path))
    return TKGDataset.from_split_tsv(train_path=str(train_p), valid_path=str(valid_p), test_path=str(test_p), delimiter=delimiter)


def load_tkg_splits_from_dir_cached(
    dir_path: str,
    *,
    cache_dir: str,
    delimiter: str = "\t",
) -> tuple[TKGDataset, TKGDataset, TKGDataset]:
    """
    Load TKG splits from a directory with a simple local cache.

    Cache contents:
    - meta.json (fingerprint, source file hashes)
    - entities.txt / relations.txt / times.txt
    - train.npy / valid.npy / test.npy: int64 arrays of shape (N,4) for (s,r,o,t)
    - train_tau.npy / valid_tau.npy / test_tau.npy: float32 arrays of shape (N,)
    """

    base = Path(dir_path)
    train_p, valid_p, test_p = _find_split_files(base)
    cdir = Path(cache_dir)
    cdir.mkdir(parents=True, exist_ok=True)

    fingerprint = {
        "schema": 1,
        "delimiter": str(delimiter),
        "train": {"path": train_p.as_posix(), "sha256": _sha256_file(train_p)},
        "valid": {"path": valid_p.as_posix(), "sha256": _sha256_file(valid_p)},
        "test": {"path": test_p.as_posix(), "sha256": _sha256_file(test_p)},
    }
    fp_json = json.dumps(fingerprint, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    fp = hashlib.sha256(fp_json).hexdigest()

    meta_path = cdir / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if isinstance(meta, dict) and meta.get("fingerprint") == fp:
            entities = _read_vocab_lines(cdir / "entities.txt")
            relations = _read_vocab_lines(cdir / "relations.txt")
            times = _read_vocab_lines(cdir / "times.txt")

            entity_to_id = {k: i for i, k in enumerate(entities)}
            relation_to_id = {k: i for i, k in enumerate(relations)}
            time_to_id = {k: i for i, k in enumerate(times)}

            def load_split(name: str) -> TKGDataset:
                arr = np.load(cdir / f"{name}.npy")
                tau = np.load(cdir / f"{name}_tau.npy")
                if arr.ndim != 2 or arr.shape[1] != 4:
                    raise ValueError(f"Invalid cached split shape for {name}: {arr.shape}")
                if tau.ndim != 1 or tau.shape[0] != arr.shape[0]:
                    raise ValueError(f"Invalid cached tau shape for {name}: {tau.shape}")
                ex = [
                    TKGExample(
                        s=int(arr[i, 0]),
                        r=int(arr[i, 1]),
                        o=int(arr[i, 2]),
                        t=int(arr[i, 3]),
                        tau=float(tau[i]),
                    )
                    for i in range(int(arr.shape[0]))
                ]
                return TKGDataset(examples=ex, entity_to_id=entity_to_id, relation_to_id=relation_to_id, time_to_id=time_to_id)

            return load_split("train"), load_split("valid"), load_split("test")

    train_rows = load_tkg_tsv(str(train_p), delimiter=delimiter)
    valid_rows = load_tkg_tsv(str(valid_p), delimiter=delimiter)
    test_rows = load_tkg_tsv(str(test_p), delimiter=delimiter)
    all_rows = list(train_rows) + list(valid_rows) + list(test_rows)

    entities = [s for s, _, _, _ in all_rows] + [o for _, _, o, _ in all_rows]
    relations = [r for _, r, _, _ in all_rows]
    times_raw = [t for *_, t in all_rows]

    entities_list, entity_to_id = _build_vocab_list(entities)
    relations_list, relation_to_id = _build_vocab_list(relations)
    times_list, time_to_id = _build_vocab_list(times_raw)

    time_values = [_parse_time_scalar(t) for t in times_raw]
    mn, mx = _minmax(time_values)

    def encode(rows: Sequence[Tuple[str, str, str, str]]) -> tuple[np.ndarray, np.ndarray, list[TKGExample]]:
        span = mx - mn
        arr = np.zeros((len(rows), 4), dtype=np.int64)
        tau = np.zeros((len(rows),), dtype=np.float32)
        ex: list[TKGExample] = []
        for i, (s, r, o, t) in enumerate(rows):
            tv = _parse_time_scalar(t)
            tt = 0.0 if span <= 0 else (tv - mn) / span
            si = entity_to_id[s]
            ri = relation_to_id[r]
            oi = entity_to_id[o]
            ti = time_to_id[t]
            arr[i, 0] = si
            arr[i, 1] = ri
            arr[i, 2] = oi
            arr[i, 3] = ti
            tau[i] = float(tt)
            ex.append(TKGExample(s=int(si), r=int(ri), o=int(oi), t=int(ti), tau=float(tt)))
        return arr, tau, ex

    train_arr, train_tau, train_ex = encode(train_rows)
    valid_arr, valid_tau, valid_ex = encode(valid_rows)
    test_arr, test_tau, test_ex = encode(test_rows)

    _write_vocab_lines(cdir / "entities.txt", entities_list)
    _write_vocab_lines(cdir / "relations.txt", relations_list)
    _write_vocab_lines(cdir / "times.txt", times_list)
    np.save(cdir / "train.npy", train_arr)
    np.save(cdir / "train_tau.npy", train_tau)
    np.save(cdir / "valid.npy", valid_arr)
    np.save(cdir / "valid_tau.npy", valid_tau)
    np.save(cdir / "test.npy", test_arr)
    np.save(cdir / "test_tau.npy", test_tau)
    meta_path.write_text(
        json.dumps(
            {
                "fingerprint": fp,
                "source": fingerprint,
                "sizes": {"train": int(train_arr.shape[0]), "valid": int(valid_arr.shape[0]), "test": int(test_arr.shape[0])},
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    tr = TKGDataset(examples=train_ex, entity_to_id=entity_to_id, relation_to_id=relation_to_id, time_to_id=time_to_id)
    va = TKGDataset(examples=valid_ex, entity_to_id=entity_to_id, relation_to_id=relation_to_id, time_to_id=time_to_id)
    te = TKGDataset(examples=test_ex, entity_to_id=entity_to_id, relation_to_id=relation_to_id, time_to_id=time_to_id)
    return tr, va, te
