from __future__ import annotations

import re
from typing import Optional

from deepseek_adapter.adid_memory import ADIDContext, InformationMark, md5_tag_for_text


def infer_information_mark(text: str) -> InformationMark:
    """
    Infer information mark from text content using heuristics.

    Classification rules:
    - EXACT: Direct quotes, citations, factual statements with sources
    - INFERRED: Logical conclusions, derived information
    - HYPOTHETICAL: Speculative statements, "what if" scenarios
    - GUESS: Uncertain statements, hedging language
    - UNKNOWN: Default for unclassified content
    """
    text_lower = text.lower().strip()
    if not text_lower:
        return InformationMark.UNKNOWN

    # Check for exact quotes or citations
    quote_patterns = [
        r'"[^"]+"',  # Double quotes
        r"'[^']+'",  # Single quotes
        r"according to",
        r"source:",
        r"citation:",
        r"references?:",
        r"\([^)]+\)",  # Parenthetical citations
    ]
    if any(re.search(pattern, text_lower) for pattern in quote_patterns):
        return InformationMark.EXACT

    # Check for inferred markers (logical conclusions)
    inferred_markers = [
        "therefore",
        "thus",
        "hence",
        "consequently",
        "as a result",
        "it follows",
        "this implies",
        "we conclude",
        "in conclusion",
    ]
    if any(marker in text_lower for marker in inferred_markers):
        return InformationMark.INFERRED

    # Check for hypothetical markers
    hypothetical_markers = [
        "if ",
        "what if",
        "suppose",
        "imagine",
        "assume",
        "hypothetically",
        "let's say",
        "assuming",
        "in the case that",
    ]
    if any(marker in text_lower for marker in hypothetical_markers):
        return InformationMark.HYPOTHETICAL

    # Check for guess markers (uncertainty)
    guess_markers = [
        "maybe",
        "perhaps",
        "might",
        "could",
        "possibly",
        "uncertain",
        "unclear",
        "not sure",
        "might be",
        "could be",
        "seems like",
        "appears to",
    ]
    if any(marker in text_lower for marker in guess_markers):
        return InformationMark.GUESS

    # Default to INFERRED for generated content (assumed to be derived from context)
    return InformationMark.INFERRED


def extract_semantic_links(text: str, *, existing_md5_tags: Optional[list[str]] = None) -> list[str]:
    """
    Extract semantic links from text by matching against existing memory entries.

    This is a simple implementation that:
    1. Extracts potential entity/keyword mentions
    2. Matches against existing MD5 tags (if provided)
    3. Returns matched tags as semantic links

    For a more sophisticated implementation, one could:
    - Use named entity recognition (NER)
    - Use keyword extraction
    - Use semantic similarity matching
    """
    if existing_md5_tags is None:
        existing_md5_tags = []

    # Simple keyword extraction (capitalized words, quoted phrases)
    keywords: set[str] = set()

    # Extract capitalized words (potential entities)
    capitalized = re.findall(r"\b[A-Z][a-z]+\b", text)
    keywords.update(c.lower() for c in capitalized)

    # Extract quoted phrases
    quoted = re.findall(r'"([^"]+)"', text)
    keywords.update(q.lower() for q in quoted)

    # Extract single-quoted phrases
    single_quoted = re.findall(r"'([^']+)'", text)
    keywords.update(q.lower() for q in single_quoted)

    # Match keywords against existing MD5 tags (simple hash-based matching)
    # In practice, this would use a more sophisticated matching algorithm
    links: list[str] = []
    for keyword in keywords:
        # Simple heuristic: if keyword appears in text and we have matching tags
        # (This is a placeholder - real implementation would use semantic similarity)
        for tag in existing_md5_tags:
            if keyword in tag.lower() or tag.lower() in keyword:
                links.append(tag)
                break

    return list(set(links))  # Deduplicate


def make_adid_context_for_text(
    text: str,
    *,
    information_mark: Optional[InformationMark] = None,
    semantic_links: Optional[list[str]] = None,
    existing_md5_tags: Optional[list[str]] = None,
) -> ADIDContext:
    """
    Create an ADID context for a text entry.

    Args:
        text: The text content
        information_mark: Optional pre-classified information mark (if None, will be inferred)
        semantic_links: Optional pre-extracted semantic links (if None, will be extracted)
        existing_md5_tags: Optional list of existing MD5 tags for semantic link matching

    Returns:
        ADIDContext with MD5 tag, information mark, and semantic links
    """
    if information_mark is None:
        information_mark = infer_information_mark(text)

    if semantic_links is None:
        semantic_links = extract_semantic_links(text, existing_md5_tags=existing_md5_tags)

    md5_tag = md5_tag_for_text(text)

    return ADIDContext(
        md5_tag=md5_tag,
        information_mark=information_mark,
        semantic_links=tuple(semantic_links),
    )
