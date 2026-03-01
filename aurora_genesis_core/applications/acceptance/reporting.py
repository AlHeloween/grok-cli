"""Reporting infrastructure for Aurora-Genesis acceptance suite (Stage 6).

Generates executive summary reports with:
- Accuracy vs context size curves
- Wall-time vs context size curves
- Teacher gate pass/fail rates
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from aurora_genesis_core.utils.artifacts import build_run_metadata


@dataclass
class AcceptanceMetrics:
    """Metrics for a single acceptance test run."""
    
    # Test identification
    variant_name: str  # Ablation variant name
    track_name: str  # Track name (e.g., "tkg", "long_context")
    
    # Accuracy metrics
    accuracy: Optional[float] = None  # Overall accuracy
    accuracy_by_context_size: dict[int, float] = field(default_factory=dict)  # Accuracy vs context size
    
    # Performance metrics
    wall_time_seconds: Optional[float] = None  # Total wall time
    wall_time_by_context_size: dict[int, float] = field(default_factory=dict)  # Wall time vs context size
    
    # Teacher gate metrics
    teacher_gate_pass_rate: Optional[float] = None  # Pass rate for teacher gates
    teacher_gate_total: int = 0  # Total gate evaluations
    teacher_gate_passed: int = 0  # Passed gate evaluations
    
    # Memory metrics
    memory_bank_size: Optional[int] = None  # Final memory bank size
    memory_promotions: int = 0  # Number of memory promotions
    
    # Compute metrics
    kv_cache_size: Optional[int] = None  # Final KV cache size (for compute reduction)
    compute_reduction_ratio: Optional[float] = None  # Compute reduction ratio (if applicable)
    
    # GPU metrics (Stage 6)
    gpu_metrics: Optional[dict[str, Any]] = None  # GPU performance metrics
    gpu_kernel_times: dict[str, float] = field(default_factory=dict)  # Per-kernel timings
    gpu_memory_usage_mb: Optional[float] = None  # GPU memory usage in MB
    gpu_utilization_percent: Optional[float] = None  # GPU utilization
    tokens_per_second_gpu: Optional[float] = None  # Throughput on GPU
    
    # Additional metadata
    metadata: dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return asdict(self)


@dataclass
class AcceptanceReport:
    """Complete acceptance suite report."""
    
    # Report metadata
    report_id: str
    timestamp_utc: str
    git_rev: Optional[str] = None
    
    # Test configuration
    ablation_matrix: dict[str, Any] = field(default_factory=dict)  # Ablation matrix used
    test_config: dict[str, Any] = field(default_factory=dict)  # Test configuration
    
    # Results
    results: list[AcceptanceMetrics] = field(default_factory=list)  # Results for each variant
    
    # Summary statistics
    summary: dict[str, Any] = field(default_factory=dict)  # Executive summary
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "report_id": self.report_id,
            "timestamp_utc": self.timestamp_utc,
            "git_rev": self.git_rev,
            "ablation_matrix": self.ablation_matrix,
            "test_config": self.test_config,
            "results": [r.to_dict() for r in self.results],
            "summary": self.summary,
        }


def generate_executive_summary(report: AcceptanceReport) -> str:
    """
    Generate executive summary markdown report.
    
    Args:
        report: Acceptance report with all results.
    
    Returns:
        Markdown-formatted executive summary.
    """
    lines = []
    lines.append("# Aurora-Genesis Acceptance Suite Report")
    lines.append("")
    lines.append(f"**Report ID**: {report.report_id}")
    lines.append(f"**Timestamp**: {report.timestamp_utc}")
    if report.git_rev:
        lines.append(f"**Git Revision**: {report.git_rev}")
    lines.append("")
    lines.append("## Executive Summary")
    lines.append("")
    
    # Summary statistics
    if report.summary:
        lines.append("### Key Findings")
        lines.append("")
        for key, value in report.summary.items():
            lines.append(f"- **{key}**: {value}")
        lines.append("")
    
    # Results by variant
    lines.append("## Results by Variant")
    lines.append("")
    
    for result in report.results:
        lines.append(f"### {result.variant_name} ({result.track_name})")
        lines.append("")
        
        if result.accuracy is not None:
            lines.append(f"- **Accuracy**: {result.accuracy:.4f}")
        if result.wall_time_seconds is not None:
            lines.append(f"- **Wall Time**: {result.wall_time_seconds:.2f}s")
        if result.teacher_gate_pass_rate is not None:
            lines.append(f"- **Teacher Gate Pass Rate**: {result.teacher_gate_pass_rate:.4f}")
        if result.memory_bank_size is not None:
            lines.append(f"- **Memory Bank Size**: {result.memory_bank_size}")
        if result.kv_cache_size is not None:
            lines.append(f"- **KV Cache Size**: {result.kv_cache_size}")
        if result.compute_reduction_ratio is not None:
            lines.append(f"- **Compute Reduction Ratio**: {result.compute_reduction_ratio:.4f}")
        
        lines.append("")
    
    # Accuracy vs context size
    lines.append("## Accuracy vs Context Size")
    lines.append("")
    lines.append("| Variant | Context Size | Accuracy |")
    lines.append("|---------|--------------|----------|")
    
    for result in report.results:
        if result.accuracy_by_context_size:
            for ctx_size, acc in sorted(result.accuracy_by_context_size.items()):
                lines.append(f"| {result.variant_name} | {ctx_size} | {acc:.4f} |")
    
    lines.append("")
    
    # Wall time vs context size
    lines.append("## Wall Time vs Context Size")
    lines.append("")
    lines.append("| Variant | Context Size | Wall Time (s) |")
    lines.append("|---------|--------------|---------------|")
    
    for result in report.results:
        if result.wall_time_by_context_size:
            for ctx_size, wall_time in sorted(result.wall_time_by_context_size.items()):
                lines.append(f"| {result.variant_name} | {ctx_size} | {wall_time:.2f} |")
    
    lines.append("")
    
    # Teacher gate statistics
    lines.append("## Teacher Gate Statistics")
    lines.append("")
    lines.append("| Variant | Total Gates | Passed | Pass Rate |")
    lines.append("|---------|------------|--------|-----------|")
    
    for result in report.results:
        if result.teacher_gate_total > 0:
            pass_rate = result.teacher_gate_passed / result.teacher_gate_total
            lines.append(f"| {result.variant_name} | {result.teacher_gate_total} | {result.teacher_gate_passed} | {pass_rate:.4f} |")
    
    lines.append("")
    
    # Conclusion
    lines.append("## Conclusion")
    lines.append("")
    lines.append("This report answers: **Do we have bounded-compute + teacher-verified memory + stable performance as context grows?**")
    lines.append("")
    
    # Check if we have bounded compute
    has_bounded_compute = False
    for result in report.results:
        if result.compute_reduction_ratio is not None and result.compute_reduction_ratio < 1.0:
            has_bounded_compute = True
            break
    
    # Check if we have teacher-verified memory
    has_teacher_verified = False
    for result in report.results:
        if result.teacher_gate_pass_rate is not None and result.teacher_gate_pass_rate > 0.0:
            has_teacher_verified = True
            break
    
    # Check if we have stable performance
    has_stable_performance = False
    for result in report.results:
        if result.accuracy_by_context_size:
            # Check if accuracy doesn't degrade significantly with context size
            accuracies = list(result.accuracy_by_context_size.values())
            if len(accuracies) > 1:
                min_acc = min(accuracies)
                max_acc = max(accuracies)
                if max_acc - min_acc < 0.1:  # Less than 10% degradation
                    has_stable_performance = True
                    break
    
    lines.append(f"- **Bounded Compute**: {'✅ Yes' if has_bounded_compute else '❌ No'}")
    lines.append(f"- **Teacher-Verified Memory**: {'✅ Yes' if has_teacher_verified else '❌ No'}")
    lines.append(f"- **Stable Performance**: {'✅ Yes' if has_stable_performance else '❌ No'}")
    lines.append("")
    
    return "\n".join(lines)


def save_acceptance_report(
    report: AcceptanceReport,
    output_dir: Path,
    include_json: bool = True,
    include_markdown: bool = True,
) -> dict[str, str]:
    """
    Save acceptance report to files.
    
    Args:
        report: Acceptance report to save.
        output_dir: Directory to save report files.
        include_json: Whether to save JSON manifest.
        include_markdown: Whether to save markdown summary.
    
    Returns:
        Dictionary mapping file type to file path.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    saved_files = {}
    
    # Save JSON manifest
    if include_json:
        json_path = output_dir / f"{report.report_id}.json"
        with open(json_path, "w") as f:
            json.dump(report.to_dict(), f, indent=2)
        saved_files["json"] = str(json_path)
    
    # Save markdown summary
    if include_markdown:
        md_path = output_dir / f"{report.report_id}.md"
        summary = generate_executive_summary(report)
        with open(md_path, "w") as f:
            f.write(summary)
        saved_files["markdown"] = str(md_path)
    
    return saved_files
