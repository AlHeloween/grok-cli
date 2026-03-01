"""Runbook utilities for standardized command execution and artifact management."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from aurora_genesis_core.utils.artifacts import build_run_metadata, set_all_seeds


@dataclass
class RunbookConfig:
    """Configuration for a standardized runbook."""
    name: str
    seed: int = 1234
    output_dir: Path = Path(".cache/runbooks")
    deterministic: bool = True


class StandardizedRunbook:
    """
    Standardized runbook executor with artifact tracking.
    
    Ensures:
    - Consistent seed handling
    - Artifact schema compliance
    - Deterministic outputs (where possible)
    """
    
    def __init__(self, config: RunbookConfig):
        self.config = config
        self.artifacts: dict[str, str] = {}
        self.inputs: dict[str, Any] = {}
        
        # Set seeds for determinism
        if self.config.deterministic:
            set_all_seeds(self.config.seed)
    
    def add_input(self, key: str, value: Any) -> None:
        """Add input parameter for tracking."""
        self.inputs[key] = value
    
    def add_artifact(self, name: str, path: Path) -> None:
        """Register an artifact file path."""
        self.artifacts[name] = str(path.as_posix())
    
    def build_report(self, results: dict[str, Any]) -> dict[str, Any]:
        """
        Build standardized report with metadata.
        
        Args:
            results: Results dictionary to include in report
        
        Returns:
            Complete report with metadata, inputs, artifacts, and results
        """
        # Add seed to inputs if not already present
        if "seed" not in self.inputs:
            self.inputs["seed"] = self.config.seed
        
        metadata = build_run_metadata(
            inputs=self.inputs,
            seed=self.config.seed,
            artifacts=self.artifacts if self.artifacts else None,
        )
        
        return {
            **metadata,
            "runbook_name": self.config.name,
            "inputs": self.inputs,
            "artifacts": self.artifacts,
            "results": results,
        }
    
    def save_report(self, report: dict[str, Any], output_path: Optional[Path] = None) -> Path:
        """
        Save report to JSON file.
        
        Args:
            report: Report dictionary
            output_path: Optional output path (defaults to output_dir/runbook_name.json)
        
        Returns:
            Path to saved report
        """
        if output_path is None:
            self.config.output_dir.mkdir(parents=True, exist_ok=True)
            output_path = self.config.output_dir / f"{self.config.name}.json"
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(report, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
        
        # Register report as artifact
        self.add_artifact("report", output_path)
        
        return output_path
