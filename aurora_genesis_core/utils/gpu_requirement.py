"""GPU requirement enforcement for AI workloads."""

from __future__ import annotations

import torch
from typing import Optional


class GPURequiredError(RuntimeError):
    """Raised when GPU is required but not available."""
    pass


def require_gpu(
    allow_cpu_fallback: bool = False,
    fallback_message: Optional[str] = None,
) -> torch.device:
    """
    Require GPU for AI workloads. Fail fast if GPU not available.
    
    This is a CRITICAL safety measure: CPU does not have ASIC matrix multiplier
    offloads, and running AI workloads on CPU will cause system hangs and potential
    data loss.
    
    Args:
        allow_cpu_fallback: If True, ask user before falling back to CPU.
                           WARNING: CPU fallback may cause system hang.
        fallback_message: Custom message for CPU fallback prompt
    
    Returns:
        torch.device("cuda") if GPU available, or torch.device("cpu") if
        fallback is explicitly confirmed by user
    
    Raises:
        GPURequiredError: If GPU not available and fallback not allowed/confirmed
    """
    if not torch.cuda.is_available():
        if allow_cpu_fallback:
            message = fallback_message or (
                "\n" + "="*80 + "\n"
                "⚠️  CRITICAL WARNING: GPU NOT AVAILABLE\n"
                "="*80 + "\n"
                "CPU does not have ASIC matrix multiplier offloads.\n"
                "Running AI workloads on CPU WILL CAUSE SYSTEM HANG.\n"
                "\n"
                "You should:\n"
                "1. Save all your work NOW\n"
                "2. Ensure GPU drivers and CUDA are properly installed\n"
                "3. Restart if needed\n"
                "\n"
                "Do you want to continue with CPU anyway? (yes/no): "
            )
            response = input(message).strip().lower()
            if response != "yes":
                raise GPURequiredError(
                    "GPU required for AI workloads. Operation cancelled to prevent system hang."
                )
            print("\n⚠️  CPU FALLBACK ENABLED - System may hang! Proceed at your own risk.\n")
            return torch.device("cpu")
        else:
            raise GPURequiredError(
                "GPU REQUIRED: CUDA not available.\n"
                "AI workloads cannot run on CPU (would cause system hang).\n"
                "Please ensure:\n"
                "  - CUDA is properly installed\n"
                "  - GPU drivers are up to date\n"
                "  - PyTorch was built with CUDA support (torch.cuda.is_available())\n"
                "\n"
                "If you MUST use CPU (not recommended), use require_gpu(allow_cpu_fallback=True)\n"
                "and confirm when prompted (after saving your work)."
            )
    
    device_count = torch.cuda.device_count()
    if device_count == 0:
        raise GPURequiredError(
            "GPU REQUIRED: No CUDA devices found.\n"
            "Please check:\n"
            "  - GPU drivers are installed\n"
            "  - GPU is properly connected\n"
            "  - CUDA toolkit is compatible with your GPU"
        )
    
    device = torch.device("cuda")
    device_name = torch.cuda.get_device_name(0)
    print(f"✓ GPU available: {device_name} (device {device})")
    return device


def get_gpu_device() -> torch.device:
    """
    Get GPU device, fail if not available.
    
    Convenience function that calls require_gpu(allow_cpu_fallback=False).
    
    Returns:
        torch.device("cuda")
    
    Raises:
        GPURequiredError: If GPU not available
    """
    return require_gpu(allow_cpu_fallback=False)


def verify_tensor_on_gpu(tensor: torch.Tensor, name: str = "tensor") -> None:
    """
    Verify that a tensor is on GPU, raise error if not.
    
    Args:
        tensor: Tensor to verify
        name: Name of tensor for error message
    
    Raises:
        GPURequiredError: If tensor is not on GPU
    """
    if tensor.device.type != "cuda":
        raise GPURequiredError(
            f"{name} must be on GPU, found {tensor.device}. "
            "AI workloads require GPU to prevent system hang."
        )
