"""Simple character-level tokenizer for Probe encoder integration."""

from __future__ import annotations

import torch
from typing import Optional


def text_to_token_ids(
    text: str,
    vocab_size: int = 256,
    max_length: int = 512,
    pad_token: int = 0,
    device: Optional[torch.device] = None,
) -> torch.Tensor:
    """
    Convert text to token IDs using character-level encoding.
    
    Args:
        text: Input text string
        vocab_size: Vocabulary size (default 256 for ASCII)
        max_length: Maximum sequence length (default 512)
        pad_token: Padding token ID (default 0)
        device: Device to create tensor on (REQUIRED for AI workloads - must be GPU)
    
    Returns:
        Token IDs tensor [1, seq_len] where seq_len <= max_length
    """
    if not text:
        result = torch.zeros((1, max_length), dtype=torch.long)
        if device is not None:
            result = result.to(device)
        return result
    
    # Convert characters to token IDs (modulo vocab_size)
    tokens = [ord(c) % vocab_size for c in text[:max_length]]
    
    # Pad to max_length if needed
    if len(tokens) < max_length:
        tokens = tokens + [pad_token] * (max_length - len(tokens))
    
    result = torch.tensor([tokens], dtype=torch.long)
    if device is not None:
        result = result.to(device)
    return result


def token_ids_to_text(
    token_ids: torch.Tensor,
    vocab_size: int = 256,
) -> str:
    """
    Convert token IDs back to text (for debugging).
    
    Args:
        token_ids: Token IDs tensor [batch, seq] or [seq]
        vocab_size: Vocabulary size (default 256)
    
    Returns:
        Decoded text string
    """
    if token_ids.dim() == 2:
        token_ids = token_ids[0]  # Take first batch
    
    # Filter out padding (0) and convert to characters
    tokens = token_ids.cpu().numpy().tolist()
    text = ''.join([chr(t) if 32 <= t < 127 else '' for t in tokens if t != 0])
    return text


def create_attention_mask(
    token_ids: torch.Tensor,
    pad_token: int = 0,
) -> Optional[torch.Tensor]:
    """
    Create attention mask from token IDs.
    
    Args:
        token_ids: Token IDs tensor [batch, seq]
        pad_token: Padding token ID (default 0)
    
    Returns:
        Attention mask [batch, seq] where 1 = valid, 0 = padding
    """
    if token_ids.dim() != 2:
        return None
    
    mask = (token_ids != pad_token).long()
    return mask
