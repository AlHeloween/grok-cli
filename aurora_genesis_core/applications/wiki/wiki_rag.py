from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Iterator, Optional

from aurora_genesis_core.memory.text_fractal_memory import TextFractalMemoryBanks
from deepseek_adapter.adid_memory import InformationMark

ProgressFn = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class WikiChunk:
    title: str
    url: Optional[str]
    chunk_id: str
    text: str


def _md5_hex(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _clean_text(s: str) -> str:
    return " ".join(str(s).replace("\r", " ").split()).strip()


def iter_chunks(
    *,
    title: str,
    url: Optional[str],
    text: str,
    chunk_chars: int,
    chunk_overlap: int,
    max_chunks_per_article: int,
) -> Iterator[WikiChunk]:
    if int(chunk_chars) < 64:
        raise ValueError("--chunk-chars must be >= 64")
    if int(chunk_overlap) < 0:
        raise ValueError("--chunk-overlap must be >= 0")
    if int(chunk_overlap) >= int(chunk_chars):
        raise ValueError("--chunk-overlap must be < --chunk-chars")
    if int(max_chunks_per_article) < 1:
        raise ValueError("--max-chunks-per-article must be >= 1")

    title = str(title).strip()
    if not title:
        title = "<untitled>"
    url = str(url).strip() if url is not None else None
    if url == "":
        url = None

    clean = _clean_text(text)
    if not clean:
        return

    step = int(chunk_chars) - int(chunk_overlap)
    emitted = 0
    start = 0
    while start < len(clean) and emitted < int(max_chunks_per_article):
        end = min(len(clean), start + int(chunk_chars))
        chunk = clean[start:end].strip()
        if chunk:
            chunk_id = _md5_hex(f"{title}\n{url or ''}\n{start}:{end}\n{chunk}")
            yield WikiChunk(title=title, url=url, chunk_id=chunk_id, text=chunk)
            emitted += 1
        start += step


def iter_wiki_chunks_from_dataset(
    *,
    ds: Any,
    max_articles: int,
    chunk_chars: int,
    chunk_overlap: int,
    max_chunks_per_article: int,
) -> Iterator[WikiChunk]:
    if int(max_articles) < 1:
        raise ValueError("--max-articles must be >= 1")
    if not hasattr(ds, "__len__"):
        raise TypeError("Expected a datasets.Dataset-like object with __len__().")
    n = min(int(max_articles), int(len(ds)))
    for i in range(n):
        row = ds[int(i)]
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or row.get("page_title") or row.get("article_title") or f"row_{i}").strip()
        url = row.get("url")
        text = row.get("text") or row.get("content") or ""
        for ch in iter_chunks(
            title=title,
            url=str(url) if url is not None else None,
            text=str(text),
            chunk_chars=int(chunk_chars),
            chunk_overlap=int(chunk_overlap),
            max_chunks_per_article=int(max_chunks_per_article),
        ):
            yield ch


@dataclass(frozen=True)
class BuildIndexStats:
    chunks_added: int
    chunks_skipped_dedup: int
    wall_s: float


def index_wiki_chunks(
    *,
    banks: TextFractalMemoryBanks,
    chunks: Iterable[WikiChunk],
    progress_every: int = 1000,
    progress: Optional[ProgressFn] = None,
) -> BuildIndexStats:
    t0 = time.perf_counter()
    added = 0
    skipped = 0
    for i, ch in enumerate(chunks, start=1):
        payload = f"TITLE: {ch.title}\nURL: {ch.url or '-'}\nTEXT: {ch.text}"
        embed_text = f"{ch.title} {ch.text[:256]}"
        ok = banks.add(
            text=payload,
            embed_text=embed_text,
            information_mark=InformationMark.EXACT,
            md5_tag=str(ch.chunk_id),
        )
        if ok:
            added += 1
        else:
            skipped += 1

        if int(progress_every) > 0 and i % int(progress_every) == 0:
            dt = time.perf_counter() - t0
            print(f"[wiki_rag] indexed chunks: {i} added={added} skipped={skipped} wall_s={dt:.1f}", flush=True)
            if progress is not None:
                progress(
                    {
                        "type": "progress",
                        "stage": "index",
                        "indexed": int(i),
                        "added": int(added),
                        "skipped": int(skipped),
                        "wall_s": float(dt),
                    }
                )
    wall = time.perf_counter() - t0
    return BuildIndexStats(chunks_added=int(added), chunks_skipped_dedup=int(skipped), wall_s=float(wall))


def build_rag_prompt(
    *,
    question: str,
    retrieved: list[str],
    max_context_chars: int,
    history: list[tuple[str, str]],
    max_history_turns: int,
) -> str:
    q = str(question).strip()
    if not q:
        raise ValueError("question must be non-empty")
    if int(max_context_chars) < 256:
        raise ValueError("--max-context-chars must be >= 256")
    if int(max_history_turns) < 0:
        raise ValueError("--max-history-turns must be >= 0")

    hist = list(history[-int(max_history_turns) :]) if int(max_history_turns) > 0 else []

    lines: list[str] = []
    lines.append("You are a helpful assistant.")
    lines.append("Answer the user's question using ONLY the provided CONTEXT.")
    lines.append("If the answer is not in the context, say: I don't know.")
    lines.append("Keep the answer concise.")
    lines.append("")
    lines.append("CONTEXT:")

    ctx = "\n\n".join([str(x).strip() for x in retrieved if str(x).strip()])
    ctx = ctx[: int(max_context_chars)]
    lines.append(ctx if ctx else "(empty)")
    lines.append("")

    if hist:
        lines.append("CHAT HISTORY (most recent last):")
        for u, a in hist:
            lines.append(f"User: {str(u).strip()}")
            lines.append(f"Assistant: {str(a).strip()}")
        lines.append("")

    lines.append(f"User: {q}")
    lines.append("Assistant:")
    return "\n".join(lines)
