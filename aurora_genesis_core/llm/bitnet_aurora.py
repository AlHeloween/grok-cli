from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

from deepseek_adapter.adid_memory import ADIDContext, InformationMark

from aurora_genesis_core.llm.bitnet_cpp import BitNetCppCliConfig, bitnet_cpp_generate, resolve_llama_cli_path
from aurora_genesis_core.memory.text_fractal_memory import (
    TextFractalMemoryBanks,
    TextMemoryEntry,
    build_text_memory_banks,
    format_memory_injection,
)
from aurora_genesis_core.memory.text_fractal_memory_io import load_text_memory_banks, save_text_memory_banks


@dataclass
class BitNetAuroraConfig:
    """Configuration for BitNet Aurora memory integration."""

    # BitNet configuration
    bitnet_config: BitNetCppCliConfig

    # Memory bank configuration
    memory_n_clusters: int = 64
    memory_dim: int = 128
    memory_depth: int = 3
    memory_seed: int = 1234
    allow_quarantine_read: bool = False

    # Retrieval configuration
    retrieval_candidate_slots: int = 4
    retrieval_top_k: int = 4

    # Memory persistence
    memory_save_dir: Optional[str] = None
    memory_load_dir: Optional[str] = None

    # ADID classification
    auto_classify_information_mark: bool = True


class BitNetAuroraSession:
    """
    Manages Aurora memory lifecycle for BitNet inference.

    This session handles:
    - Memory bank initialization and persistence
    - Pre-retrieval from memory banks
    - Prompt augmentation with retrieved context
    - Post-generation memory writes with ADID routing
    """

    def __init__(self, *, config: BitNetAuroraConfig) -> None:
        self.config = config
        self.memory_banks: Optional[TextFractalMemoryBanks] = None
        self._initialize_memory()

    def _initialize_memory(self) -> None:
        """Initialize memory banks from config or load from disk."""
        if self.config.memory_load_dir:
            load_path = Path(self.config.memory_load_dir)
            if load_path.exists():
                try:
                    self.memory_banks, _meta = load_text_memory_banks(out_dir=str(load_path))
                    return
                except Exception as e:
                    raise RuntimeError(f"Failed to load memory banks from {load_path}: {e}") from e

        self.memory_banks = build_text_memory_banks(
            n_clusters=self.config.memory_n_clusters,
            dim=self.config.memory_dim,
            depth=self.config.memory_depth,
            seed=self.config.memory_seed,
            allow_quarantine_read=self.config.allow_quarantine_read,
        )

    def save_memory(self, *, out_dir: Optional[str] = None) -> str:
        """Save memory banks to disk."""
        if self.memory_banks is None:
            raise RuntimeError("Memory banks not initialized")
        save_dir = out_dir or self.config.memory_save_dir
        if not save_dir:
            raise ValueError("save_dir must be provided or set in config.memory_save_dir")
        meta = {
            "config": {
                "n_clusters": self.config.memory_n_clusters,
                "dim": self.config.memory_dim,
                "depth": self.config.memory_depth,
                "seed": self.config.memory_seed,
            }
        }
        return save_text_memory_banks(banks=self.memory_banks, out_dir=save_dir, meta=meta)

    def retrieve_memory(self, *, prompt: str) -> list[TextMemoryEntry]:
        """Retrieve relevant memory entries for a prompt."""
        if self.memory_banks is None:
            raise RuntimeError("Memory banks not initialized")
        return self.memory_banks.query(
            text=prompt,
            candidate_slots=self.config.retrieval_candidate_slots,
            top_k=self.config.retrieval_top_k,
        )

    def augment_prompt(self, *, prompt: str, retrieved: list[TextMemoryEntry]) -> str:
        """Augment prompt with retrieved memory context."""
        if not retrieved:
            return prompt
        memory_context = format_memory_injection(retrieved)
        return f"{memory_context}\n\n{prompt}"

    def classify_information_mark(self, *, text: str) -> InformationMark:
        """
        Automatically classify information mark for generated text.

        Simple heuristic-based classification:
        - EXACT: Direct quotes, factual statements with citations
        - INFERRED: Logical conclusions, "therefore", "thus"
        - HYPOTHETICAL: "if", "what if", "suppose", "imagine"
        - GUESS: "maybe", "perhaps", "might", "could"
        - UNKNOWN: Default
        """
        if not self.config.auto_classify_information_mark:
            return InformationMark.UNKNOWN

        text_lower = text.lower()

        # Check for exact quotes or citations
        if '"' in text or "'" in text or "according to" in text_lower or "source:" in text_lower:
            return InformationMark.EXACT

        # Check for inferred markers
        inferred_markers = ["therefore", "thus", "hence", "consequently", "as a result", "it follows"]
        if any(marker in text_lower for marker in inferred_markers):
            return InformationMark.INFERRED

        # Check for hypothetical markers
        hypothetical_markers = ["if", "what if", "suppose", "imagine", "assume", "hypothetically"]
        if any(marker in text_lower for marker in hypothetical_markers):
            return InformationMark.HYPOTHETICAL

        # Check for guess markers
        guess_markers = ["maybe", "perhaps", "might", "could", "possibly", "uncertain", "unclear"]
        if any(marker in text_lower for marker in guess_markers):
            return InformationMark.GUESS

        # Default to INFERRED for generated content (assumed to be derived from context)
        return InformationMark.INFERRED

    def write_to_memory(
        self,
        *,
        text: str,
        information_mark: Optional[InformationMark] = None,
        md5_tag: Optional[str] = None,
    ) -> bool:
        """Write generated text to memory banks with ADID routing."""
        if self.memory_banks is None:
            raise RuntimeError("Memory banks not initialized")

        if information_mark is None:
            information_mark = self.classify_information_mark(text=text)

        return self.memory_banks.add(
            text=text,
            information_mark=information_mark,
            md5_tag=md5_tag,
        )

    def stats(self) -> dict:
        """Get memory bank statistics."""
        if self.memory_banks is None:
            return {"error": "Memory banks not initialized"}
        return self.memory_banks.stats()


def bitnet_aurora_generate(
    *,
    prompt: str,
    session: BitNetAuroraSession,
    llama_cli_path: Optional[Path] = None,
    bitnet_dir: Optional[Path] = None,
    extra_args: Sequence[str] = (),
) -> tuple[str, float, dict]:
    """
    Generate text via BitNet with Aurora memory integration.

    Returns:
        (completion, wall_s, metadata) where metadata contains:
        - retrieved_count: number of memory entries retrieved
        - memory_written: whether the completion was written to memory
        - information_mark: classified information mark
    """
    # Pre-retrieval: Query memory banks
    retrieved = session.retrieve_memory(prompt=prompt)

    # Augment prompt with retrieved context
    augmented_prompt = session.augment_prompt(prompt=prompt, retrieved=retrieved)

    # Generate with BitNet
    completion, wall_s = bitnet_cpp_generate(
        prompt=augmented_prompt,
        cfg=session.config.bitnet_config,
        llama_cli_path=llama_cli_path,
        bitnet_dir=bitnet_dir,
        extra_args=extra_args,
    )

    # Post-generation: Write to memory
    information_mark = session.classify_information_mark(text=completion)
    memory_written = session.write_to_memory(
        text=completion,
        information_mark=information_mark,
    )

    metadata = {
        "retrieved_count": len(retrieved),
        "memory_written": memory_written,
        "information_mark": information_mark.value,
    }

    return completion, wall_s, metadata
