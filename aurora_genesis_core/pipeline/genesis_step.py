'''Genesis step: periodic SE(3) clustering consolidation with buffer management.'''

from __future__ import annotations

from typing import List, Optional, Tuple, Union

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False
    torch = None  # type: ignore

if not _TORCH_AVAILABLE:
    raise ImportError(
        "aurora_genesis_core.pipeline.genesis_step requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )

from aurora_genesis_core.se3.kmedoids import SE3KMedoids
from aurora_genesis_core.memory.genesis import GenesisMemory
from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor
from aurora_genesis_core.pipeline.genesis_metrics import GenesisMetrics, compute_genesis_metrics
from aurora_genesis_core.pipeline.genesis_gates import (
    GenesisGateThresholds,
    GenesisGateDecision,
    evaluate_genesis_gates,
)


class GenesisStep:
    """
    Periodic SE(3) clustering consolidation with buffer management.

    Collects embeddings in a buffer and periodically runs SE(3) K-Medoids
    clustering to consolidate memory bank into geometrically consistent medoids.

    Attributes:
        buffer_size: Maximum buffer size before triggering Genesis step.
        k_medoids_k: Number of medoids for SE(3) K-Medoids.
        w_rot: Weight for rotational distance component.
        w_trans: Weight for translational distance component.
        device: PyTorch device.
        buffer: List of accumulated embeddings.
        memory: Genesis memory instance for refinement.
    """

    def __init__(
        self,
        buffer_size: int = 4096,
        k_medoids_k: int = 64,
        k_medoids_max_iter: int = 10,
        k_medoids_tol: float = 1e-4,
        w_rot: float = 1.0,
        w_trans: float = 1.0,
        device: Optional[str] = None,
    ):
        """
        Initialize Genesis step.

        Args:
            buffer_size: Maximum buffer size before triggering Genesis step.
            k_medoids_k: Number of medoids for SE(3) K-Medoids.
            w_rot: Weight for rotational distance component.
            w_trans: Weight for translational distance component.
            device: PyTorch device ('cuda', 'cpu', etc.). Defaults to 'cuda' if available.
        """
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"

        self.buffer_size = buffer_size
        self.k_medoids_k = k_medoids_k
        self.k_medoids_max_iter = k_medoids_max_iter
        self.k_medoids_tol = k_medoids_tol
        self.w_rot = w_rot
        self.w_trans = w_trans
        self.device = device

        self.buffer: List[torch.Tensor] = []
        self.memory: Optional[GenesisMemory] = None
        self._clusterer: Optional[SE3KMedoids] = None
        self._previous_medoids: Optional[torch.Tensor] = None  # For shift calculation

    def add_to_buffer(self, embeddings: Union[torch.Tensor, DualComplexTensor]) -> None:
        """
        Add embeddings to Genesis buffer.

        Args:
            embeddings: Embeddings tensor (batch_size, seq_len, n_dim) or DualComplexTensor.
                If DualComplexTensor, extracts primal component and converts to dual quaternions.
        """
        # Extract primal component if DualComplexTensor
        if isinstance(embeddings, DualComplexTensor):
            embeddings_primal = embeddings.primal
            # Convert to dual quaternions (if needed) - for now, use simple projection
            # Extract rotation quaternion (first 4 dims, normalized) and translation (next 3 dims)
            batch_size, seq_len, n_dim = embeddings_primal.shape
            if n_dim >= 4:
                rot = embeddings_primal[..., :4]  # (batch, seq, 4)
                rot_norm = torch.norm(rot, dim=-1, keepdim=True)
                rot_normalized = rot / (rot_norm + 1e-8)
                if n_dim >= 7:
                    trans = embeddings_primal[..., 4:7]  # (batch, seq, 3)
                else:
                    trans = torch.zeros(batch_size, seq_len, 3, device=embeddings_primal.device, dtype=embeddings_primal.dtype)
                # Construct dual quaternion: [wr, xr, yr, zr, 0, tx/2, ty/2, tz/2]
                dual_w = torch.zeros(batch_size, seq_len, 1, device=embeddings_primal.device, dtype=embeddings_primal.dtype)
                dual_xyz = trans / 2.0
                dual = torch.cat([dual_w, dual_xyz], dim=-1)  # (batch, seq, 4)
                embeddings_dq = torch.cat([rot_normalized, dual], dim=-1)  # (batch, seq, 8)
            else:
                # Not enough dimensions, use identity dual quaternion
                embeddings_dq = torch.zeros(batch_size, seq_len, 8, device=embeddings_primal.device, dtype=embeddings_primal.dtype)
                embeddings_dq[..., 0] = 1.0  # w = 1
            embeddings_tensor = embeddings_dq
        else:
            # Assume embeddings are already in dual quaternion format or convert
            embeddings_tensor = embeddings

        # Flatten batch and sequence dimensions
        batch_size, seq_len, n_dim = embeddings_tensor.shape
        embeddings_flat = embeddings_tensor.view(batch_size * seq_len, n_dim)  # (batch*seq, n_dim)

        # Add to buffer
        self.buffer.append(embeddings_flat)

        # Trim buffer if exceeds buffer_size
        total_size = sum(b.shape[0] for b in self.buffer)
        if total_size > self.buffer_size:
            # Keep most recent entries
            trimmed: List[torch.Tensor] = []
            current_size = 0
            for b in reversed(self.buffer):
                if current_size + b.shape[0] <= self.buffer_size:
                    trimmed.insert(0, b)
                    current_size += b.shape[0]
                else:
                    # Take partial from this buffer entry
                    take = self.buffer_size - current_size
                    trimmed.insert(0, b[-take:])
                    break
            self.buffer = trimmed

    def should_trigger(self) -> bool:
        """Check if Genesis step should be triggered (buffer is full)."""
        total_size = sum(b.shape[0] for b in self.buffer)
        return total_size >= self.buffer_size

    def run(
        self,
        return_metrics: bool = True,
        gate_thresholds: Optional[GenesisGateThresholds] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, Optional[GenesisMetrics], Optional[GenesisGateDecision]]:
        """
        Run Genesis step: consolidate buffer embeddings via SE(3) K-Medoids.

        Args:
            return_metrics: If True, compute and return Genesis metrics.
            gate_thresholds: Optional gate thresholds for stability checks.

        Returns:
            Tuple of (medoids, labels, metrics, gate_decision):
            - medoids: Consolidated medoids tensor (k_medoids_k, 8) on GPU.
            - labels: Cluster assignments for buffer embeddings.
            - metrics: GenesisMetrics object if return_metrics=True, else None.
            - gate_decision: GenesisGateDecision if gate_thresholds provided, else None.

        Raises:
            RuntimeError: If buffer is empty or has insufficient entries, or if abort gate triggers.
        """
        if not self.buffer:
            raise RuntimeError("Genesis buffer is empty. Cannot run Genesis step.")

        # Concatenate buffer embeddings
        buffer_tensor = torch.cat(self.buffer, dim=0)  # (total_size, n_dim)

        # Ensure buffer has at least k_medoids_k entries
        if buffer_tensor.shape[0] < self.k_medoids_k:
            raise RuntimeError(
                f"Buffer size ({buffer_tensor.shape[0]}) is less than k_medoids_k ({self.k_medoids_k}). "
                "Cannot run Genesis step."
            )

        # Ensure embeddings are dual quaternions (8 dimensions)
        if buffer_tensor.shape[1] != 8:
            raise ValueError(
                f"Expected dual quaternion embeddings with 8 dimensions, got {buffer_tensor.shape[1]}"
            )

        # Initialize clusterer if needed
        if self._clusterer is None:
            self._clusterer = SE3KMedoids(
                n_clusters=self.k_medoids_k,
                max_iter=self.k_medoids_max_iter,
                tol=self.k_medoids_tol,
            )

        # Run SE(3) K-Medoids clustering
        labels, medoids = self._clusterer.fit(buffer_tensor)

        # Compute metrics if requested
        metrics = None
        gate_decision = None
        if return_metrics:
            # Get convergence info from clusterer
            converged = self._clusterer.converged
            iterations = self._clusterer.iterations
            
            metrics = compute_genesis_metrics(
                buffer_embeddings=buffer_tensor,
                medoids=medoids,
                labels=labels,
                previous_medoids=self._previous_medoids,
                w_rot=self.w_rot,
                w_trans=self.w_trans,
                converged=converged,
                iterations=iterations,
            )
            
            # Evaluate gates if thresholds provided
            if gate_thresholds is not None:
                gate_decision = evaluate_genesis_gates(metrics, gate_thresholds)
                
                # Abort if gate decision says so
                if gate_decision.abort:
                    raise RuntimeError(f"Genesis step aborted: {gate_decision.reason}")
        
        # Store medoids for next shift calculation
        self._previous_medoids = medoids.clone()

        # Clear buffer after Genesis step
        self.buffer.clear()

        return medoids, labels, metrics, gate_decision

    def clear_buffer(self) -> None:
        """Clear the Genesis buffer."""
        self.buffer.clear()
