from __future__ import annotations

from typing import Optional

from aurora_genesis_core.memory.text_fractal_memory import TextMemoryEntry


def format_memory_context(entries: list[TextMemoryEntry], *, mode: str = "compact") -> str:
    """
    Format retrieved memory entries as context text.

    Args:
        entries: List of retrieved memory entries
        mode: Formatting mode:
            - "compact": Simple list format
            - "detailed": Include information marks
            - "numbered": Numbered list format

    Returns:
        Formatted context string
    """
    if not entries:
        return ""

    if mode == "compact":
        lines = ["<memory>"]
        for e in entries:
            lines.append(e.text)
        lines.append("</memory>")
        return "\n".join(lines)

    elif mode == "detailed":
        lines = ["<memory>"]
        for e in entries:
            lines.append(f"[{e.information_mark.value}] {e.text}")
        lines.append("</memory>")
        return "\n".join(lines)

    elif mode == "numbered":
        lines = ["<memory>"]
        for i, e in enumerate(entries, 1):
            lines.append(f"{i}. {e.text}")
        lines.append("</memory>")
        return "\n".join(lines)

    else:
        raise ValueError(f"Unknown mode: {mode}")


def augment_prompt_with_memory(
    prompt: str,
    retrieved: list[TextMemoryEntry],
    *,
    max_tokens: Optional[int] = None,
    mode: str = "compact",
    context_prefix: str = "Context from memory:",
) -> str:
    """
    Augment a prompt with retrieved memory context.

    Args:
        prompt: Original prompt
        retrieved: Retrieved memory entries
        max_tokens: Optional maximum token count (not enforced, just for documentation)
        mode: Formatting mode for memory context (see format_memory_context)
        context_prefix: Prefix text before memory context

    Returns:
        Augmented prompt with memory context
    """
    if not retrieved:
        return prompt

    memory_context = format_memory_context(entries=retrieved, mode=mode)

    # Combine context and prompt
    if context_prefix:
        augmented = f"{context_prefix}\n{memory_context}\n\n{prompt}"
    else:
        augmented = f"{memory_context}\n\n{prompt}"

    # Note: max_tokens is not enforced here - caller should handle truncation
    # if needed based on model's context window
    return augmented


def truncate_prompt(prompt: str, *, max_chars: int) -> str:
    """
    Truncate a prompt to fit within character limit.

    This is a simple character-based truncation. For token-based truncation,
    use a tokenizer.

    Args:
        prompt: Prompt to truncate
        max_chars: Maximum character count

    Returns:
        Truncated prompt (with ellipsis if truncated)
    """
    if len(prompt) <= max_chars:
        return prompt

    # Try to truncate at a word boundary
    truncated = prompt[: max_chars - 3]
    last_space = truncated.rfind(" ")
    if last_space > max_chars * 0.8:  # Only use word boundary if not too short
        truncated = truncated[:last_space]
    return truncated + "..."
