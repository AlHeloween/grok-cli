"""
Python wrapper for C++ CUDA probe implementations.

This module provides Python bindings to the C++ CUDA probe implementations
for performance comparison with the pure Python versions.
"""

from __future__ import annotations

import ctypes
import os
from pathlib import Path
from typing import Optional

import torch

from aurora_genesis_core.probe.dual_quaternion import DualQuaternionTensor
from aurora_genesis_core.utils.gpu_requirement import require_gpu


# Try to load the C++ CUDA library
_PROBE_CUDA_LIB = None
_PROBE_CUDA_AVAILABLE = False
_PROBE_CUDA_LOAD_ERROR: Optional[str] = None

try:
    # Look for compiled library in external/bitnet/build
    repo_root = Path(__file__).resolve().parents[3]
    lib_paths = [
        repo_root / "external" / "bitnet" / "build" / "lib" / "libprobe_cuda.dll",  # Windows
        repo_root / "external" / "bitnet" / "build" / "lib" / "libprobe_cuda.so",  # Linux
        repo_root / "external" / "bitnet" / "build" / "lib" / "libprobe_cuda.dylib",  # macOS
    ]
    
    for lib_path in lib_paths:
        if lib_path.exists():
            _PROBE_CUDA_LIB = ctypes.CDLL(str(lib_path))
            _PROBE_CUDA_AVAILABLE = True
            break
except (OSError, ImportError) as exc:
    _PROBE_CUDA_LOAD_ERROR = f"{type(exc).__name__}: {exc}"
    _PROBE_CUDA_AVAILABLE = False


def is_cpp_cuda_available() -> bool:
    """Check if C++ CUDA probe implementation is available."""
    return _PROBE_CUDA_AVAILABLE


class ProbeCUDADQLinear:
    """
    C++ CUDA implementation of DQLinear for performance comparison.
    
    This is a wrapper around the C++ CUDA implementation that can be
    used as a drop-in replacement for the Python DQLinear.
    """
    
    def __init__(
        self,
        in_features: int,
        out_features: int,
        bias: bool = True,
        device: Optional[torch.device] = None,
    ) -> None:
        if not _PROBE_CUDA_AVAILABLE:
            raise RuntimeError(
                "C++ CUDA probe library not available."
                + (f" Load error: {_PROBE_CUDA_LOAD_ERROR}" if _PROBE_CUDA_LOAD_ERROR else "")
                + " Please compile the library first (see docs/probe_cpp_cuda_build.md)."
            )
        
        self.in_features = int(in_features)
        self.out_features = int(out_features)
        self.bias = bias
        if device is None:
            self.device = require_gpu(allow_cpu_fallback=False)
        else:
            self.device = device
            if self.device.type != "cuda":
                raise ValueError("ProbeCUDADQLinear requires a CUDA device")
        
        # Initialize weights (same as Python version)
        self.weight = torch.empty(
            (out_features, in_features, 8),
            device=self.device,
            dtype=torch.float32,
        )
        self._init_weights()
        
        if bias:
            self.bias_tensor = torch.empty(
                (out_features, 8),
                device=self.device,
                dtype=torch.float32,
            )
            self._init_bias()
        else:
            self.bias_tensor = None
    
    def _init_weights(self) -> None:
        """Initialize weights (same as Python DQLinear)."""
        with torch.no_grad():
            self.weight[..., 0] = 1.0
            self.weight[..., 1:4] = torch.randn_like(self.weight[..., 1:4]) * 0.01
            rot_norm = torch.norm(self.weight[..., 0:4], dim=-1, keepdim=True)
            self.weight[..., 0:4] = self.weight[..., 0:4] / (rot_norm + 1e-8)
            self.weight[..., 4:8] = torch.randn_like(self.weight[..., 4:8]) * 0.001
    
    def _init_bias(self) -> None:
        """Initialize bias (same as Python DQLinear)."""
        with torch.no_grad():
            self.bias_tensor[..., 0] = 1.0
            self.bias_tensor[..., 1:4] = 0.0
            self.bias_tensor[..., 4:8] = 0.0
    
    def forward(self, x: DualQuaternionTensor) -> DualQuaternionTensor:
        """
        Forward pass using C++ CUDA implementation.
        
        Args:
            x: Input dual quaternion tensor [..., in_features, 8]
        
        Returns:
            Output dual quaternion tensor [..., out_features, 8]
        """
        if x.device.type != "cuda":
            raise RuntimeError("C++ CUDA implementation requires CUDA tensors")
        
        # Get shape
        original_shape = x.shape
        batch_dims = original_shape[:-2]
        in_features = original_shape[-2]
        
        # Flatten batch dimensions
        batch_size = 1
        seq_len = 1
        for dim in batch_dims:
            batch_size *= dim
        
        if len(batch_dims) > 1:
            seq_len = batch_dims[-1]
            batch_size = batch_dims[0] if len(batch_dims) > 1 else 1
        
        # Reshape to [batch, seq, in_features, 8]
        x_flat = x.data.view(batch_size, seq_len, in_features, 8)
        
        # Create output tensor
        output = torch.empty(
            (batch_size, seq_len, self.out_features, 8),
            device=x.device,
            dtype=x.dtype,
        )
        
        # Call C++ CUDA function
        if _PROBE_CUDA_LIB is not None:
            # Get function pointer
            dq_linear_func = _PROBE_CUDA_LIB.probe_cuda_dq_linear
            dq_linear_func.argtypes = [
                ctypes.POINTER(ctypes.c_float),  # weight
                ctypes.POINTER(ctypes.c_float),  # input
                ctypes.POINTER(ctypes.c_float),  # output
                ctypes.c_int,  # batch_size
                ctypes.c_int,  # seq_len
                ctypes.c_int,  # in_features
                ctypes.c_int,  # out_features
            ]
            dq_linear_func.restype = ctypes.c_int
            
            # Get CUDA pointers (PyTorch tensors are already on CUDA)
            # Use ctypes to create pointers from PyTorch tensor data pointers
            weight_ptr = ctypes.c_void_p(self.weight.data_ptr())
            input_ptr = ctypes.c_void_p(x_flat.data_ptr())
            output_ptr = ctypes.c_void_p(output.data_ptr())
            
            # Call C++ CUDA function
            result_code = dq_linear_func(
                ctypes.cast(weight_ptr, ctypes.POINTER(ctypes.c_float)),
                ctypes.cast(input_ptr, ctypes.POINTER(ctypes.c_float)),
                ctypes.cast(output_ptr, ctypes.POINTER(ctypes.c_float)),
                batch_size,
                seq_len,
                in_features,
                self.out_features,
            )
            
            if result_code != 0:
                raise RuntimeError(f"C++ CUDA DQLinear failed with code {result_code}")
            
            # Add bias if present
            if self.bias_tensor is not None:
                output = output + self.bias_tensor.unsqueeze(0).unsqueeze(0)
            
            result = DualQuaternionTensor(output)
        else:
            # Fallback to Python implementation
            from aurora_genesis_core.probe.dq_linear import DQLinear
            python_layer = DQLinear(
                self.in_features,
                self.out_features,
                bias=self.bias,
                device=self.device,
            )
            python_layer.weight.data = self.weight
            if self.bias_tensor is not None:
                python_layer.bias.data = self.bias_tensor
            
            result = python_layer(x)
        
        # Reshape back to original shape
        output_reshaped = result.data.view(*original_shape[:-2], self.out_features, 8)
        return DualQuaternionTensor(output_reshaped)


def benchmark_probe_operations(
    batch_size: int = 1,
    seq_len: int = 512,
    hidden_size: int = 768,
    num_iterations: int = 100,
) -> dict[str, float]:
    """
    Benchmark Python vs C++ CUDA probe operations.
    
    Args:
        batch_size: Batch size
        seq_len: Sequence length
        hidden_size: Hidden size
        num_iterations: Number of iterations to run
    
    Returns:
        Dictionary with timing results
    """
    import time
    
    device = require_gpu(allow_cpu_fallback=False)
    
    # Create test data
    x = DualQuaternionTensor(
        torch.randn(batch_size, seq_len, hidden_size, 8, device=device)
    )
    
    results = {}
    
    # Benchmark Python DQLinear
    from aurora_genesis_core.probe.dq_linear import DQLinear
    
    python_layer = DQLinear(
        in_features=hidden_size,
        out_features=hidden_size,
        bias=True,
        device=device,
    )
    
    # Warmup
    for _ in range(10):
        _ = python_layer(x)
    
    torch.cuda.synchronize() if device.type == "cuda" else None
    start_time = time.time()
    for _ in range(num_iterations):
        _ = python_layer(x)
    torch.cuda.synchronize() if device.type == "cuda" else None
    python_time = (time.time() - start_time) / num_iterations
    
    results["python_dq_linear_ms"] = python_time * 1000
    
    # Benchmark C++ CUDA DQLinear (if available)
    if _PROBE_CUDA_AVAILABLE:
        try:
            cpp_layer = ProbeCUDADQLinear(
                in_features=hidden_size,
                out_features=hidden_size,
                bias=True,
                device=device,
            )
            
            # Warmup
            for _ in range(10):
                _ = cpp_layer.forward(x)
            
            torch.cuda.synchronize() if device.type == "cuda" else None
            start_time = time.time()
            for _ in range(num_iterations):
                _ = cpp_layer.forward(x)
            torch.cuda.synchronize() if device.type == "cuda" else None
            cpp_time = (time.time() - start_time) / num_iterations
            
            results["cpp_cuda_dq_linear_ms"] = cpp_time * 1000
            results["speedup"] = python_time / cpp_time if cpp_time > 0 else 0.0
        except Exception as e:
            results["cpp_cuda_error"] = str(e)
    else:
        results["cpp_cuda_available"] = False
    
    return results
