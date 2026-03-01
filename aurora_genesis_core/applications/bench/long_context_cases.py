from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional


@dataclass(frozen=True)
class LongContextCase:
    n_facts: int
    query_index: int
    target_key: str
    question: str
    expected_value: str

    baseline_ok: Optional[bool]
    baseline_extracted_value: Optional[str]
    baseline_correct: Optional[bool]
    baseline_wall_s: Optional[float]

    retrieve_hit: Optional[bool]
    inject_has_expected_value: Optional[bool]

    memory_ok: Optional[bool]
    memory_extracted_value: Optional[str]
    memory_correct: Optional[bool]
    memory_wall_s: Optional[float]


def _sanitize_cell(x: Any) -> str:
    s = "" if x is None else str(x)
    return s.replace("\t", " ").replace("\r", " ").replace("\n", " ").strip()


def _get(d: Any, key: str, default: Any) -> Any:
    if not isinstance(d, dict):
        return default
    if key not in d:
        return default
    return d[key]


def extract_long_context_cases(
    report: dict[str, Any],
    *,
    max_cases_per_size: Optional[int] = None,
    max_total_cases: Optional[int] = None,
) -> list[LongContextCase]:
    runs = report.get("runs", [])
    if not isinstance(runs, list):
        raise TypeError("Expected report['runs'] to be a list.")

    per_size_limit = None if max_cases_per_size is None else int(max_cases_per_size)
    if per_size_limit is not None and per_size_limit < 1:
        raise ValueError("--max-cases-per-size must be >= 1")
    total_limit = None if max_total_cases is None else int(max_total_cases)
    if total_limit is not None and total_limit < 1:
        raise ValueError("--max-total-cases must be >= 1")

    out: list[LongContextCase] = []
    for r in runs:
        if not isinstance(r, dict):
            continue
        n_facts = int(_get(r, "n_facts", 0))
        queries = _get(r, "queries", [])
        if not isinstance(queries, list):
            continue

        seen_for_size = 0
        for qi, q in enumerate(queries):
            if not isinstance(q, dict):
                continue
            if per_size_limit is not None and seen_for_size >= per_size_limit:
                break
            if total_limit is not None and len(out) >= total_limit:
                return out

            target_key = str(_get(q, "target_key", "")).strip()
            expected_value = str(_get(q, "expected_value", "")).strip()
            if not target_key or not expected_value:
                continue

            question = f"QUESTION: What is the VALUE for KEY {target_key}?"

            baseline = _get(q, "baseline", {})
            memory = _get(q, "memory", {})
            retrieve = _get(q, "retrieve", {})

            out.append(
                LongContextCase(
                    n_facts=int(n_facts),
                    query_index=int(qi),
                    target_key=target_key,
                    question=question,
                    expected_value=expected_value,
                    baseline_ok=_get(baseline, "ok", None),
                    baseline_extracted_value=_get(baseline, "extracted_value", None),
                    baseline_correct=_get(baseline, "correct", None),
                    baseline_wall_s=_get(baseline, "wall_s", None),
                    retrieve_hit=_get(retrieve, "hit", None),
                    inject_has_expected_value=_get(retrieve, "inject_has_expected_value", None),
                    memory_ok=_get(memory, "ok", None),
                    memory_extracted_value=_get(memory, "extracted_value", None),
                    memory_correct=_get(memory, "correct", None),
                    memory_wall_s=_get(memory, "wall_s", None),
                )
            )
            seen_for_size += 1

    return out


def write_long_context_cases_tsv(path: str, cases: list[LongContextCase]) -> str:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    if not cases:
        raise ValueError("No cases to write.")

    header = [
        "n_facts",
        "query_index",
        "target_key",
        "question",
        "expected_value",
        "baseline_ok",
        "baseline_extracted_value",
        "baseline_correct",
        "baseline_wall_s",
        "retrieve_hit",
        "inject_has_expected_value",
        "memory_ok",
        "memory_extracted_value",
        "memory_correct",
        "memory_wall_s",
    ]
    lines: list[str] = ["\t".join(header)]
    for c in cases:
        row = [
            str(int(c.n_facts)),
            str(int(c.query_index)),
            _sanitize_cell(c.target_key),
            _sanitize_cell(c.question),
            _sanitize_cell(c.expected_value),
            _sanitize_cell(c.baseline_ok),
            _sanitize_cell(c.baseline_extracted_value),
            _sanitize_cell(c.baseline_correct),
            _sanitize_cell(c.baseline_wall_s),
            _sanitize_cell(c.retrieve_hit),
            _sanitize_cell(c.inject_has_expected_value),
            _sanitize_cell(c.memory_ok),
            _sanitize_cell(c.memory_extracted_value),
            _sanitize_cell(c.memory_correct),
            _sanitize_cell(c.memory_wall_s),
        ]
        lines.append("\t".join(row))
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p.as_posix()

