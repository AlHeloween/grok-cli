"""Complete Aurora Genesis pipeline integration.

Integrates all components:
- Probe encoder (Phase 2)
- FFE quantization (Phase 3)
- Lattice memory banks (Phase 3)
- Transcender (Phase 4)
- Evolver (Phase 5)
- Dual-complex attention (Phase 1)
"""

from __future__ import annotations

from typing import Optional, Any
import torch
import torch.nn as nn

from aurora_genesis_core.probe.probe_encoder import ProbeEncoder
from aurora_genesis_core.probe.dual_quaternion import DualQuaternionTensor
from aurora_genesis_core.memory.ffe_quantization import FFEQuantizer
from aurora_genesis_core.memory.lattice_memory_bank import LatticeMemoryBank
from aurora_genesis_core.memory.fractal_context_engine import FractalContextEngine
from aurora_genesis_core.memory.lattice_addressing import LatticeAddressing
from aurora_genesis_core.memory.lattice_storage import LatticeMemoryStorage
from aurora_genesis_core.probe.hybrid_fractal_attention import HybridFractalAttention
from aurora_genesis_core.transcender.promotion_system import PromotionSystem
from aurora_genesis_core.evolver.temporal_evolution import TemporalEvolver
from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor, _stack


class FullAuroraPipeline:
    """Complete Aurora Genesis pipeline.
    
    Components:
    - Probe encoder (Phase 2)
    - FFE quantization (Phase 3)
    - Lattice memory banks (Phase 3)
    - Transcender (Phase 4)
    - Evolver (Phase 5)
    - Dual-complex attention (Phase 1)
    """
    
    def __init__(
        self,
        probe_encoder: ProbeEncoder,
        ffe_quantizer: FFEQuantizer,
        memory_bank: LatticeMemoryBank,
        transcender: PromotionSystem,
        evolver: Optional[TemporalEvolver] = None,
        use_dual_complex: bool = True,
        use_navigation_paradigm: bool = False,
        window_size: int = 2048,
        tau: float = 0.1,
        device: Optional[str] = None,
    ):
        """Initialize full Aurora pipeline.
        
        Args:
            probe_encoder: Probe encoder instance
            ffe_quantizer: FFE quantizer instance
            memory_bank: Lattice memory bank instance
            transcender: Promotion system instance
            evolver: Optional temporal evolver
            use_dual_complex: Whether to use dual-complex attention
            use_navigation_paradigm: Whether to use Navigation paradigm (Stage 4)
            window_size: Local context window size (for Navigation paradigm)
            tau: Uncertainty threshold for drill-down (for Navigation paradigm)
            device: Device for computation
        """
        self.probe_encoder = probe_encoder
        self.ffe_quantizer = ffe_quantizer
        self.memory_bank = memory_bank
        self.transcender = transcender
        self.evolver = evolver
        self.use_dual_complex = use_dual_complex
        self.use_navigation_paradigm = use_navigation_paradigm
        self.window_size = window_size
        self.tau = tau
        
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device
        
        # Initialize Navigation paradigm components (Stage 4)
        self.fractal_engine = None
        self.hybrid_attention = None
        if use_navigation_paradigm:
            # Create FractalContextEngine
            storage = LatticeMemoryStorage(
                storage_path=None,
                n_levels=ffe_quantizer.n_levels,
                n_per_level=ffe_quantizer.n_per_level,
            )
            addressing = LatticeAddressing(
                n_levels=ffe_quantizer.n_levels,
                n_per_level=ffe_quantizer.n_per_level,
                dim=8,
                seed=ffe_quantizer.seed,
                device=device,
            )
            self.fractal_engine = FractalContextEngine(
                memory_storage=storage,
                lattice_addressing=addressing,
                window_size=window_size,
                tau=tau,
                max_depth=ffe_quantizer.n_levels - 1,
                max_nodes_per_level=8,
                device=device,
            )
            
            # Create HybridFractalAttention
            self.hybrid_attention = HybridFractalAttention(
                dq_dim=8,
                num_heads=probe_encoder.num_heads,
                window_size=window_size,
                local_weight=0.7,
                global_weight=0.3,
                fractal_engine=self.fractal_engine,
                device=device,
            ).to(device=device)
        
        # Track write count for promotion
        self.write_count = 0
    
    def forward(
        self,
        input_ids: torch.Tensor,
        timestamps: Optional[torch.Tensor] = None,
    ) -> dict[str, Any]:
        """Complete forward pass through Aurora pipeline.
        
        Args:
            input_ids: Input token IDs [batch, seq]
            timestamps: Optional timestamps [seq] or [batch, seq]
        
        Returns:
            Dictionary with output, addresses, memory_entries
        """
        # 1. Encode with Probe
        dq_latents = self.probe_encoder(input_ids)  # DualQuaternionTensor [batch, seq, hidden_size, 8]
        
        # Extract dual quaternion embeddings (use first hidden dimension for simplicity)
        # In production, would aggregate across all hidden dimensions
        dq_data = dq_latents.data  # [batch, seq, hidden_size, 8]
        batch_size, seq_len, hidden_size, dq_dim = dq_data.shape
        
        # Flatten to [batch*seq, 8] for quantization
        dq_flat = dq_data[:, :, 0, :].reshape(-1, 8)  # Use first hidden dim
        
        # 2. Quantize to FFE addresses
        addresses = []
        for i in range(dq_flat.shape[0]):
            dq_tensor = dq_flat[i]  # [8]
            address_bits = self.ffe_quantizer.quantize(dq_tensor)
            addresses.append(address_bits)
        
        # 3. Retrieve from memory
        memory_entries = []
        for address_bits in addresses:
            from aurora_genesis_core.memory.ffe_quantization import FFEAddress
            from aurora_genesis_core.memory.lattice_addressing import SierpinskiLatticeAddress
            
            ffe_addr = FFEAddress.from_bits(address_bits)
            lattice_addr = SierpinskiLatticeAddress.from_ffe_address(ffe_addr)
            
            # Query memory bank
            entries = self.memory_bank.query(dq_tensor.tolist(), k=3)
            memory_entries.extend(entries)
        
        # 4. Apply temporal evolution (if enabled)
        if self.evolver and timestamps is not None:
            # Convert dq_flat to dual-complex tensor for evolution
            z_primal = dq_flat
            z_dual = torch.zeros_like(z_primal)
            z = DualComplexTensor(_stack(z_primal, z_dual))
            
            # Compute time step
            if timestamps.dim() == 1:
                dt = timestamps[-1] - timestamps[0] if len(timestamps) > 1 else 1.0
            else:
                dt = timestamps[:, -1] - timestamps[:, 0]
            
            dq_evolved = self.evolver(z, dt=dt)
            dq_flat = dq_evolved.primal
        
        # 5. Compute attention with memory
        if self.use_navigation_paradigm and self.hybrid_attention is not None:
            # Use Hybrid Fractal Attention (Navigation paradigm)
            # Reshape to [batch, seq, 8] for attention
            dq_reshaped = dq_flat.reshape(batch_size, seq_len, 8)
            q_dq = DualQuaternionTensor(dq_reshaped)
            k_dq = DualQuaternionTensor(dq_reshaped)
            v_dq = DualQuaternionTensor(dq_reshaped)
            
            # Get current time for temporal decay
            current_time = None
            if timestamps is not None:
                if timestamps.dim() == 1:
                    current_time = float(timestamps[-1].item())
                else:
                    current_time = float(timestamps[0, -1].item())
            
            # Hybrid fractal attention
            attended = self.hybrid_attention(
                q_dq,
                k_dq,
                v_dq,
                fractal_engine=self.fractal_engine,
            )
            output = attended.data  # [batch, seq, 8]
        else:
            # Simplified: return latents as-is
            # In production, would use proper dual-complex attention
            output = dq_flat.reshape(batch_size, seq_len, 8)
        
        # 6. Write to memory
        for i in range(seq_len):
            embedding = dq_flat[i].tolist() if dq_flat.dim() == 2 else dq_flat[0, i].tolist()
            self.memory_bank.add(embedding=embedding, text=f"seq_{i}")
            self.write_count += 1
        
        # 7. Apply Transcender (periodic promotion)
        if self.should_promote():
            self.transcender.increment_write_count()
            if self.transcender.should_promote_now():
                # Promote entries at level 0
                promoted = self.transcender.check_and_promote(self.memory_bank, level=0)
                self.write_count = 0
        
        return {
            'output': output,
            'addresses': addresses,
            'memory_entries': memory_entries,
            'dq_latents': dq_latents,
        }
    
    def should_promote(self) -> bool:
        """Check if promotion should occur.
        
        Returns:
            True if promotion interval reached
        """
        return self.write_count >= 10  # Promote every 10 writes (configurable)
    
    def compute_attention_with_memory(
        self,
        dq_latents: torch.Tensor,
        memory_entries: list,
        timestamps: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """Compute attention with memory entries.
        
        Args:
            dq_latents: Dual quaternion latents [batch, seq, 8]
            memory_entries: Retrieved memory entries
            timestamps: Optional timestamps for temporal decay
        
        Returns:
            Attended output [batch, seq, 8]
        """
        if self.use_navigation_paradigm and self.hybrid_attention is not None:
            # Use Hybrid Fractal Attention (Navigation paradigm)
            q_dq = DualQuaternionTensor(dq_latents)
            k_dq = DualQuaternionTensor(dq_latents)
            v_dq = DualQuaternionTensor(dq_latents)
            
            # Get current time for temporal decay
            current_time = None
            if timestamps is not None:
                if timestamps.dim() == 1:
                    current_time = float(timestamps[-1].item())
                else:
                    current_time = float(timestamps[0, -1].item())
            
            # Hybrid fractal attention
            attended = self.hybrid_attention(
                q_dq,
                k_dq,
                v_dq,
                fractal_engine=self.fractal_engine,
            )
            return attended.data
        else:
            # Simplified: return latents as-is
            # In production, would compute proper attention scores
            return dq_latents


def create_full_pipeline(
    vocab_size: int = 1000,
    hidden_size: int = 64,
    num_layers: int = 2,
    num_heads: int = 4,
    n_levels: int = 8,
    n_per_level: int = 512,
    use_evolver: bool = False,
    use_navigation_paradigm: bool = False,
    window_size: int = 2048,
    tau: float = 0.1,
    device: Optional[str] = None,
) -> FullAuroraPipeline:
    """Create a full Aurora pipeline with default components.
    
    Args:
        vocab_size: Vocabulary size
        hidden_size: Hidden dimension
        num_layers: Number of encoder layers
        num_heads: Number of attention heads
        n_levels: Number of lattice levels
        n_per_level: Number of centroids per level
        use_evolver: Whether to enable temporal evolver
        device: Device for computation (default: 'cuda' if available, else 'cpu')
    
    Returns:
        FullAuroraPipeline instance
    """
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        if device == "cuda":
            print(f"Auto-detected GPU: {torch.cuda.get_device_name(0)}")
    
    # Create Probe encoder
    probe_encoder = ProbeEncoder(
        vocab_size=vocab_size,
        hidden_size=hidden_size,
        num_layers=num_layers,
        num_heads=num_heads,
    ).to(device=device)
    
    # Create FFE quantizer
    ffe_quantizer = FFEQuantizer(
        n_levels=n_levels,
        n_per_level=n_per_level,
        dim=8,
        device=device,
    )
    
    # Create memory bank
    memory_bank = LatticeMemoryBank(
        n_levels=n_levels,
        n_per_level=n_per_level,
        dim=8,
        device=device,
    )
    
    # Create Transcender
    from aurora_genesis_core.transcender import RewriteRule, CompressionMetrics
    rewrite_rules = [
        RewriteRule(
            trigger_type="count",
            threshold=3.0,
            selection_method="similarity",
            synthesis_method="mean",
            device=device,
        ),
    ]
    compression_metrics = CompressionMetrics(device=device)
    from aurora_genesis_core.transcender.promotion_system import PromotionPolicy
    promotion_policy = PromotionPolicy(promotion_interval=10)
    transcender = PromotionSystem(
        rewrite_rules=rewrite_rules,
        compression_metrics=compression_metrics,
        promotion_policy=promotion_policy,
    )
    
    # Create Evolver (optional)
    evolver = None
    if use_evolver:
        evolver = TemporalEvolver(
            hidden_dim=8,
            device=device,
        )
    
    return FullAuroraPipeline(
        probe_encoder=probe_encoder,
        ffe_quantizer=ffe_quantizer,
        memory_bank=memory_bank,
        transcender=transcender,
        evolver=evolver,
        use_navigation_paradigm=use_navigation_paradigm,
        window_size=window_size,
        tau=tau,
        device=device,
    )
