"""Hook-path SE(3) pose extraction from hidden states (Stage 5).

Extracts pose latents from hidden states in the hook/sidecar path and buffers them
for Genesis consolidation, matching the HF path behavior.
"""

from __future__ import annotations

from typing import List, Optional

try:
    import torch
    import torch.nn as nn
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore
    nn = None  # type: ignore

if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.pipeline.hook_pose_extraction requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )

from aurora_genesis_core.pipeline.pose_projection import HiddenToDualQuaternion


class HookPoseExtractor:
    """
    Extract pose latents from hidden states in hook/sidecar path.
    
    This class provides a simplified hook-path pose extraction that matches
    the HF path behavior. It extracts hidden states from hook points and projects
    them to dual quaternions for Genesis consolidation.
    
    Attributes:
        projector: HiddenToDualQuaternion projection module.
        hidden_states_buffer: Buffer for accumulating hidden states.
        pose_buffer: Buffer for accumulating pose latents (dual quaternions).
        enabled: Whether pose extraction is enabled.
    """
    
    def __init__(
        self,
        hidden_dim: int,
        device: Optional[str] = None,
        enabled: bool = True,
    ):
        """
        Initialize hook-path pose extractor.
        
        Args:
            hidden_dim: Hidden dimension size.
            device: PyTorch device ('cuda', 'cpu', etc.). Defaults to 'cuda' if available.
            enabled: Whether pose extraction is enabled.
        """
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        
        self.projector = HiddenToDualQuaternion(hidden_dim).to(device)
        self.device = device
        self.enabled = enabled
        
        # Buffers for accumulating hidden states and poses
        self.hidden_states_buffer: List[torch.Tensor] = []
        self.pose_buffer: List[torch.Tensor] = []
    
    def extract_pose_from_hidden(
        self,
        hidden_states: torch.Tensor,
        layer_idx: Optional[int] = None,
    ) -> Optional[torch.Tensor]:
        """
        Extract pose latents from hidden states.
        
        Args:
            hidden_states: Hidden states tensor (B, T, H) or (B*T, H).
            layer_idx: Optional layer index for logging.
        
        Returns:
            Pose latents as dual quaternions (B, T, 8) or None if disabled.
        """
        if not self.enabled:
            return None
        
        # Ensure hidden states are on correct device
        hidden_states = hidden_states.to(self.device)
        
        # Handle 2D input (flattened batch*sequence)
        if hidden_states.ndim == 2:
            # Reshape to (B, T, H) - assume batch_size=1 for hook path
            # This is a simplification; in practice, you'd track batch size
            hidden_states = hidden_states.unsqueeze(0)  # (1, T, H)
        
        # Project to dual quaternions
        pose_latents = self.projector(hidden_states)  # (B, T, 8)
        
        return pose_latents
    
    def add_to_buffer(
        self,
        hidden_states: torch.Tensor,
        layer_idx: Optional[int] = None,
    ) -> None:
        """
        Extract pose from hidden states and add to buffer.
        
        Args:
            hidden_states: Hidden states tensor (B, T, H) or (B*T, H).
            layer_idx: Optional layer index for logging.
        """
        if not self.enabled:
            return
        
        pose_latents = self.extract_pose_from_hidden(hidden_states, layer_idx=layer_idx)
        if pose_latents is not None:
            # Flatten batch and sequence dimensions for buffer
            batch_size, seq_len, dq_dim = pose_latents.shape
            pose_flat = pose_latents.view(batch_size * seq_len, dq_dim)  # (B*T, 8)
            self.pose_buffer.append(pose_flat)
            self.hidden_states_buffer.append(hidden_states)
    
    def get_buffered_poses(self) -> Optional[torch.Tensor]:
        """
        Get all buffered pose latents as a single tensor.
        
        Returns:
            Concatenated pose latents (N, 8) or None if buffer is empty.
        """
        if not self.pose_buffer:
            return None
        
        return torch.cat(self.pose_buffer, dim=0)  # (N, 8)
    
    def clear_buffer(self) -> None:
        """Clear pose and hidden states buffers."""
        self.pose_buffer.clear()
        self.hidden_states_buffer.clear()
    
    def set_enabled(self, enabled: bool) -> None:
        """Enable or disable pose extraction."""
        self.enabled = enabled
    
    def get_buffer_size(self) -> int:
        """Get current buffer size (number of pose latents)."""
        if not self.pose_buffer:
            return 0
        return sum(p.shape[0] for p in self.pose_buffer)
