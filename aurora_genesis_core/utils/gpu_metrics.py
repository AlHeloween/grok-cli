"""GPU metrics extraction from C++ CUDA runs.

Stage 6: Real model tests with GPU metrics collection.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Any
import subprocess
import re
import json


@dataclass
class GPUMetrics:
    """GPU performance metrics from C++ CUDA runs."""
    
    # Kernel timings (milliseconds)
    dual_quat_ops_time: float = 0.0
    fractal_drill_down_time: float = 0.0
    attention_time: float = 0.0
    memory_transfer_time: float = 0.0
    memory_query_time: float = 0.0
    
    # Total GPU time
    total_gpu_time: float = 0.0
    
    # Memory usage (bytes)
    gpu_memory_allocated: int = 0
    gpu_memory_used: int = 0
    
    # Throughput
    tokens_per_second: float = 0.0
    
    # Device info
    gpu_name: Optional[str] = None
    cuda_version: Optional[str] = None
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "dual_quat_ops_time_ms": self.dual_quat_ops_time,
            "fractal_drill_down_time_ms": self.fractal_drill_down_time,
            "attention_time_ms": self.attention_time,
            "memory_transfer_time_ms": self.memory_transfer_time,
            "memory_query_time_ms": self.memory_query_time,
            "total_gpu_time_ms": self.total_gpu_time,
            "gpu_memory_allocated_bytes": self.gpu_memory_allocated,
            "gpu_memory_used_bytes": self.gpu_memory_used,
            "tokens_per_second": self.tokens_per_second,
            "gpu_name": self.gpu_name,
            "cuda_version": self.cuda_version,
        }


def extract_gpu_metrics_from_llama_output(output: str) -> GPUMetrics:
    """Extract GPU metrics from llama.cpp output.
    
    Parses lines like:
    - AURORA_GPU_DUAL_QUAT_OPS_TIME=1.234
    - AURORA_GPU_FRACTAL_DRILL_DOWN_TIME=2.456
    - AURORA_GPU_MEMORY_TRANSFER_TIME=0.789
    """
    metrics = GPUMetrics()
    
    # Parse CUDA timing output
    patterns = {
        'dual_quat_ops_time': r'AURORA_GPU_DUAL_QUAT_OPS_TIME=([\d.]+)',
        'fractal_drill_down_time': r'AURORA_GPU_FRACTAL_DRILL_DOWN_TIME=([\d.]+)',
        'attention_time': r'AURORA_GPU_ATTENTION_TIME=([\d.]+)',
        'memory_transfer_time': r'AURORA_GPU_MEMORY_TRANSFER_TIME=([\d.]+)',
        'memory_query_time': r'AURORA_GPU_MEMORY_QUERY_TIME=([\d.]+)',
        'total_gpu_time': r'AURORA_GPU_TOTAL_TIME=([\d.]+)',
    }
    
    for attr, pattern in patterns.items():
        match = re.search(pattern, output, re.MULTILINE)
        if match:
            setattr(metrics, attr, float(match.group(1)))
    
    # Compute total if not explicitly set
    if metrics.total_gpu_time == 0.0:
        metrics.total_gpu_time = (
            metrics.dual_quat_ops_time +
            metrics.fractal_drill_down_time +
            metrics.attention_time +
            metrics.memory_transfer_time +
            metrics.memory_query_time
        )
    
    return metrics


def get_nvidia_smi_metrics() -> dict[str, Any]:
    """Get GPU metrics from nvidia-smi.
    
    Returns:
        Dictionary with GPU metrics:
        - gpu_name: GPU model name
        - memory_used_mb: GPU memory used in MB
        - memory_total_mb: Total GPU memory in MB
        - utilization_percent: GPU utilization percentage
    """
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=name,memory.used,memory.total,utilization.gpu', 
             '--format=csv,noheader,nounits'],
            capture_output=True,
            text=True,
            timeout=5.0,
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if lines:
                parts = lines[0].split(', ')
                if len(parts) >= 4:
                    return {
                        'gpu_name': parts[0].strip(),
                        'memory_used_mb': int(parts[1].strip()),
                        'memory_total_mb': int(parts[2].strip()),
                        'utilization_percent': int(parts[3].strip()),
                    }
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError) as e:
        # nvidia-smi not available or parse error
        pass
    return {}


def get_cuda_version() -> Optional[str]:
    """Get CUDA version from nvidia-smi."""
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=driver_version', '--format=csv,noheader'],
            capture_output=True,
            text=True,
            timeout=5.0,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def combine_gpu_metrics(
    llama_metrics: GPUMetrics,
    nvidia_smi: dict[str, Any],
    tokens_processed: int = 0,
    elapsed_wall_time: float = 0.0,
) -> dict[str, Any]:
    """Combine GPU metrics from multiple sources.
    
    Args:
        llama_metrics: Metrics extracted from llama.cpp output
        nvidia_smi: Metrics from nvidia-smi
        tokens_processed: Number of tokens processed
        elapsed_wall_time: Wall-clock time in seconds
        
    Returns:
        Combined metrics dictionary
    """
    combined = llama_metrics.to_dict()
    
    # Add nvidia-smi metrics
    if nvidia_smi:
        combined['gpu_name'] = nvidia_smi.get('gpu_name', llama_metrics.gpu_name)
        combined['gpu_memory_used_mb'] = nvidia_smi.get('memory_used_mb', 0)
        combined['gpu_memory_total_mb'] = nvidia_smi.get('memory_total_mb', 0)
        combined['gpu_utilization_percent'] = nvidia_smi.get('utilization_percent', 0)
    
    # Compute throughput
    if elapsed_wall_time > 0 and tokens_processed > 0:
        combined['tokens_per_second'] = tokens_processed / elapsed_wall_time
    elif llama_metrics.total_gpu_time > 0 and tokens_processed > 0:
        # Use GPU time if wall time not available
        combined['tokens_per_second'] = tokens_processed / (llama_metrics.total_gpu_time / 1000.0)
    
    # Add CUDA version
    cuda_version = get_cuda_version()
    if cuda_version:
        combined['cuda_version'] = cuda_version
    
    return combined
