"""
CUDA kernels for quaternion operations.

These kernels are compiled with nvcc for GPU capability 6.1+
where torch.compile/Triton are not available.
"""

from aurora_genesis_core.probe.cuda_kernels.quaternion_kernels import (
    cuda_quat_multiply_batched,
    cuda_hamilton_product_batched,
    cuda_attention_scores_batched,
    is_nvcc_available,
)

__all__ = [
    "cuda_quat_multiply_batched",
    "cuda_hamilton_product_batched",
    "cuda_attention_scores_batched",
    "is_nvcc_available",
]
