"""
DQLinear: Hamilton product-based linear layer for dual quaternions.

This implements a linear layer where the forward pass uses Hamilton product
instead of standard matrix multiplication, operating on dual quaternions.

OPTIMIZED: Uses larger chunk sizes and fully vectorized operations for GPU.
"""

from __future__ import annotations

import math
from typing import Optional

import torch
from torch import nn

from aurora_genesis_core.probe.dual_quaternion import (
    DualQuaternionTensor,
    hamilton_product,
    dual_quat_add,
)


def _batched_quat_multiply_4d(q1: torch.Tensor, q2: torch.Tensor) -> torch.Tensor:
    """
    Fully vectorized quaternion multiplication for 4D tensors.
    
    Args:
        q1: Quaternion tensor [batch, out, in, 4]
        q2: Quaternion tensor [batch, out, in, 4]
    
    Returns:
        Product quaternion [batch, out, in, 4]
    """
    w1, x1, y1, z1 = q1[..., 0], q1[..., 1], q1[..., 2], q1[..., 3]
    w2, x2, y2, z2 = q2[..., 0], q2[..., 1], q2[..., 2], q2[..., 3]
    
    w = w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2
    x = w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2
    y = w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2
    z = w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2
    
    return torch.stack([w, x, y, z], dim=-1)


def batch_hamilton_product_matrix_vectorized(
    weight: torch.Tensor,  # [out_features, in_features, 8]
    x: torch.Tensor,  # [batch_size, in_features, 8]
) -> torch.Tensor:
    """
    Fully vectorized Hamilton product matrix multiplication.
    
    Computes: y[i] = sum_j (W[i, j] * x[j]) for each output feature i
    where * is Hamilton product.
    
    Uses full broadcasting - no Python loops. Best for GPU workloads.
    
    Args:
        weight: Weight tensor [out_features, in_features, 8]
        x: Input tensor [batch_size, in_features, 8]
    
    Returns:
        Output tensor [batch_size, out_features, 8]
    """
    batch_size, in_features, _ = x.shape
    out_features = weight.shape[0]
    
    # Split into rotation and translation parts
    x_r = x[..., :4]  # [batch, in, 4]
    x_d = x[..., 4:]  # [batch, in, 4]
    w_r = weight[..., :4]  # [out, in, 4]
    w_d = weight[..., 4:]  # [out, in, 4]
    
    # Broadcast to [batch, out, in, 4]
    x_r_exp = x_r.unsqueeze(1).expand(-1, out_features, -1, -1)  # [batch, out, in, 4]
    x_d_exp = x_d.unsqueeze(1).expand(-1, out_features, -1, -1)  # [batch, out, in, 4]
    w_r_exp = w_r.unsqueeze(0).expand(batch_size, -1, -1, -1)    # [batch, out, in, 4]
    w_d_exp = w_d.unsqueeze(0).expand(batch_size, -1, -1, -1)    # [batch, out, in, 4]
    
    # Rotation part: x_r * w_r using vectorized multiplication
    prod_r = _batched_quat_multiply_4d(x_r_exp, w_r_exp)  # [batch, out, in, 4]
    
    # Translation part: x_r * w_d + x_d * w_r
    prod_d1 = _batched_quat_multiply_4d(x_r_exp, w_d_exp)  # [batch, out, in, 4]
    prod_d2 = _batched_quat_multiply_4d(x_d_exp, w_r_exp)  # [batch, out, in, 4]
    prod_d = prod_d1 + prod_d2  # [batch, out, in, 4]
    
    # Concatenate rotation and translation
    prod_full = torch.cat([prod_r, prod_d], dim=-1)  # [batch, out, in, 8]
    
    # Sum over input features
    output = prod_full.sum(dim=2)  # [batch, out, 8]
    
    return output


def batch_hamilton_product_matrix_chunked(
    weight: torch.Tensor,  # [out_features, in_features, 8]
    x: torch.Tensor,  # [batch_size, in_features, 8]
    chunk_size: int = 64,
) -> torch.Tensor:
    """
    Memory-efficient chunked Hamilton product matrix multiplication.
    
    Uses chunking to limit memory usage for very large layers.
    
    Args:
        weight: Weight tensor [out_features, in_features, 8]
        x: Input tensor [batch_size, in_features, 8]
        chunk_size: Number of output features to process at a time
    
    Returns:
        Output tensor [batch_size, out_features, 8]
    """
    batch_size, in_features, _ = x.shape
    out_features = weight.shape[0]
    
    # Split into rotation and translation parts
    x_r = x[..., :4]  # [batch, in, 4]
    x_d = x[..., 4:]  # [batch, in, 4]
    
    outputs = []
    for out_start in range(0, out_features, chunk_size):
        out_end = min(out_start + chunk_size, out_features)
        chunk_len = out_end - out_start
        w_chunk = weight[out_start:out_end]  # [chunk, in, 8]
        w_r_chunk = w_chunk[..., :4]  # [chunk, in, 4]
        w_d_chunk = w_chunk[..., 4:]  # [chunk, in, 4]
        
        # Broadcast: [batch, chunk, in, 4]
        x_r_exp = x_r.unsqueeze(1).expand(-1, chunk_len, -1, -1)
        x_d_exp = x_d.unsqueeze(1).expand(-1, chunk_len, -1, -1)
        w_r_exp = w_r_chunk.unsqueeze(0).expand(batch_size, -1, -1, -1)
        w_d_exp = w_d_chunk.unsqueeze(0).expand(batch_size, -1, -1, -1)
        
        # Compute quaternion products using vectorized function
        prod_r = _batched_quat_multiply_4d(x_r_exp, w_r_exp)
        prod_d1 = _batched_quat_multiply_4d(x_r_exp, w_d_exp)
        prod_d2 = _batched_quat_multiply_4d(x_d_exp, w_r_exp)
        prod_d = prod_d1 + prod_d2
        
        prod_full = torch.cat([prod_r, prod_d], dim=-1)  # [batch, chunk, in, 8]
        output_chunk = prod_full.sum(dim=2)  # [batch, chunk, 8]
        outputs.append(output_chunk)
    
    return torch.cat(outputs, dim=1)


def batch_hamilton_product_matrix(
    weight: torch.Tensor,  # [out_features, in_features, 8]
    x: torch.Tensor,  # [batch_size, in_features, 8]
) -> torch.Tensor:
    """
    Efficient batch Hamilton product matrix multiplication.
    
    Automatically selects between fully vectorized and chunked implementations
    based on tensor sizes to balance speed vs memory.
    
    Args:
        weight: Weight tensor [out_features, in_features, 8]
        x: Input tensor [batch_size, in_features, 8]
    
    Returns:
        Output tensor [batch_size, out_features, 8]
    """
    batch_size, in_features, _ = x.shape
    out_features = weight.shape[0]
    
    # Estimate memory usage for full vectorization
    # Full tensor would be [batch, out, in, 8] floats = batch * out * in * 8 * 4 bytes
    estimated_memory_mb = (batch_size * out_features * in_features * 8 * 4) / (1024 * 1024)
    
    # Use full vectorization for smaller tensors, chunked for larger
    # Threshold: ~512 MB intermediate tensor
    MEMORY_THRESHOLD_MB = 512
    
    if estimated_memory_mb < MEMORY_THRESHOLD_MB:
        # Full vectorization - fastest for GPU
        return batch_hamilton_product_matrix_vectorized(weight, x)
    else:
        # Chunked processing - memory efficient
        # Use larger chunks for better GPU utilization
        return batch_hamilton_product_matrix_chunked(weight, x, chunk_size=64)


class DQLinear(nn.Module):
    """
    Hamilton product-based linear layer for dual quaternions.
    
    OPTIMIZED: Uses fully vectorized operations with automatic memory management.
    
    Forward: y = W * x (Hamilton product)
    where W and x are dual quaternions.
    
    Weight shape: [out_features, in_features, 8]
    Input shape: [..., in_features, 8] (dual quaternion per feature)
    Output shape: [..., out_features, 8] (dual quaternion per feature)
    """
    
    def __init__(
        self,
        in_features: int,
        out_features: int,
        bias: bool = True,
        device: Optional[torch.device] = None,
        dtype: Optional[torch.dtype] = None,
    ) -> None:
        super().__init__()
        self.in_features = int(in_features)
        self.out_features = int(out_features)
        
        # Weight: [out_features, in_features, 8] (dual quaternion per connection)
        self.weight = nn.Parameter(
            torch.empty((out_features, in_features, 8), device=device, dtype=dtype)
        )
        
        if bias:
            # Bias: [out_features, 8] (dual quaternion per output)
            self.bias = nn.Parameter(
                torch.empty((out_features, 8), device=device, dtype=dtype)
            )
        else:
            self.register_parameter("bias", None)
        
        self.reset_parameters()
    
    def reset_parameters(self) -> None:
        """Initialize weights and bias."""
        with torch.no_grad():
            # Rotation part: unit quaternions with small perturbations
            self.weight[..., 0] = 1.0  # w component
            self.weight[..., 1:4] = torch.randn_like(self.weight[..., 1:4]) * 0.01
            rot_norm = torch.norm(self.weight[..., 0:4], dim=-1, keepdim=True)
            self.weight[..., 0:4] = self.weight[..., 0:4] / (rot_norm + 1e-8)
            
            # Translation part: small values
            self.weight[..., 4:8] = torch.randn_like(self.weight[..., 4:8]) * 0.001
            
            if self.bias is not None:
                self.bias[..., 0] = 1.0
                self.bias[..., 1:4] = 0.0
                self.bias[..., 4:8] = 0.0
    
    def forward(self, x: DualQuaternionTensor) -> DualQuaternionTensor:
        """
        Forward pass: y = W * x + b (Hamilton product)
        
        Args:
            x: Input dual quaternion tensor [..., in_features, 8]
        
        Returns:
            Output dual quaternion tensor [..., out_features, 8]
        """
        # Reshape for batch processing
        original_shape = x.shape
        batch_dims = original_shape[:-2]
        in_features = original_shape[-2]
        
        # Flatten batch dimensions
        x_flat = x.data.view(-1, in_features, 8)  # [batch_size, in_features, 8]
        batch_size = x_flat.shape[0]
        
        # Compute Hamilton product matrix multiplication (optimized)
        output_data = batch_hamilton_product_matrix(self.weight, x_flat)
        
        # Add bias if present (vectorized)
        if self.bias is not None:
            output_data = output_data + self.bias.unsqueeze(0)
        
        # Reshape back to original batch dimensions
        output_shape = (*batch_dims, self.out_features, 8)
        output_data = output_data.view(*output_shape)
        
        return DualQuaternionTensor(output_data)
