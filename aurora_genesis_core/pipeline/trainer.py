'''Unified pipeline trainer: end-to-end Aurora-Genesis training/inference runtime.'''

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Optional, Union

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
        "aurora_genesis_core.pipeline.trainer requires torch. "
        "Install project dependencies so `torch` is available (see docs/handover.md)."
    )

from deepseek_adapter.config import AuroraConfig
from deepseek_adapter.adid_memory import ADIDContext
from deepseek_adapter.torch_aurora_wrapper import (
    AuroraHookSession,
    DualComplexAdapter,
    build_memory_from_cfg,
    load_adid_banks,
    save_adid_banks,
    _infer_hidden_dim,
)
from aurora_genesis_core.pipeline.dual_complex_encoder import DualComplexEncoder
from aurora_genesis_core.pipeline.memory_addressing import MemoryAddressing
from aurora_genesis_core.pipeline.genesis_step import GenesisStep
from aurora_genesis_core.pipeline.genesis_scheduler import GenesisScheduler
from aurora_genesis_core.pipeline.pose_projection import HiddenToDualQuaternion
from aurora_genesis_core.pipeline.hook_pose_extraction import HookPoseExtractor
from aurora_genesis_core.pipeline.loss_assembly import LossAssembly
from aurora_genesis_core.pipeline.stability import check_finite_tensor
from aurora_genesis_core.dual_complex.torch_backend import DualComplexTensor, _stack


def _resolve_torch_dtype(name: str) -> torch.dtype:
    s = str(name).strip().lower()
    if s in ("bf16", "bfloat16"):
        return torch.bfloat16
    if s in ("fp16", "float16", "half"):
        return torch.float16
    if s in ("fp32", "float32", "float"):
        return torch.float32
    raise ValueError(f"Unsupported engine_dtype: {name!r} (expected bf16/fp16/fp32)")


def _filter_kwargs_by_signature(fn: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    sig = inspect.signature(fn)
    allowed = set(sig.parameters.keys())
    return {k: v for k, v in kwargs.items() if k in allowed}


@dataclass(frozen=True)
class _HFOutputs:
    logits: torch.Tensor
    hidden_states: Optional[tuple[torch.Tensor, ...]]


def _extract_hf_outputs(output: Any) -> _HFOutputs:
    logits = getattr(output, "logits", None)
    hidden_states = getattr(output, "hidden_states", None)
    if torch.is_tensor(logits):
        hs = None
        if isinstance(hidden_states, (tuple, list)):
            hs = tuple(hidden_states)
        return _HFOutputs(logits=logits, hidden_states=hs)

    if isinstance(output, (tuple, list)) and output:
        if not torch.is_tensor(output[0]):
            raise TypeError("HF model output[0] must be a Tensor logits")
        logits_t = output[0]
        hs = None
        if len(output) >= 3 and isinstance(output[2], (tuple, list)):
            hs = tuple(output[2])
        return _HFOutputs(logits=logits_t, hidden_states=hs)

    raise TypeError(f"Unsupported HF model output type: {type(output).__name__}")


class AuroraGenesisTrainer:
    """
    Unified pipeline trainer for end-to-end Aurora-Genesis training/inference.

    Integrates:
    - Dual-complex encoding (optional)
    - Sierpinski memory addressing (optional)
    - SE(3) Genesis consolidation (optional)
    - Loss assembly (primal + optional dual)

    Attributes:
        config: AuroraConfig with all feature flags and parameters.
        model: Base model (can be DeepSeek-VL wrapper or simpler test model).
        encoder: Dual-complex encoder (if use_dual_complex=True).
        memory: Memory addressing module (if init_sierpinski=True).
        genesis: Genesis step module (if enable_se3_clustering=True).
        loss_fn: Loss assembly module.
        step_count: Current training step count.
    """

    def __init__(
        self,
        config: AuroraConfig,
        model: Optional[nn.Module] = None,
        vocab_size: int = 32000,
        hidden_size: int = 128,
    ):
        """
        Initialize Aurora-Genesis trainer.

        Args:
            config: AuroraConfig with all feature flags and parameters.
            model: Base model for forward pass. If None, creates a simple test model.
            vocab_size: Vocabulary size (used if encoder is created).
            hidden_size: Hidden dimension size (used if encoder is created).
        """
        if config.dual_loss_weight > 0 and not config.use_dual_complex:
            raise ValueError("dual_loss_weight > 0 requires use_dual_complex=True")

        self.config = config
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.step_count = 0

        self.engine_name = str(config.engine_name).strip()
        if self.engine_name not in ("toy", "hf_causal_lm"):
            raise ValueError(
                f"Unsupported engine_name: {self.engine_name!r} (expected 'toy' or 'hf_causal_lm')"
            )

        self._hook_dca: Optional[DualComplexAdapter] = None
        self._hook_memory: Optional[nn.Module] = None
        self._hf_root_model: Optional[nn.Module] = None
        self.optimizer: Optional[torch.optim.Optimizer] = None

        # Initialize base model
        if self.engine_name == "toy":
            if model is None:
                self.model = nn.Sequential(
                    nn.Linear(hidden_size, hidden_size),
                    nn.ReLU(),
                    nn.Linear(hidden_size, vocab_size),
                ).to(self.device)
            else:
                self.model = model.to(self.device)
        else:
            if model is None:
                model_path = config.engine_model_path
                if model_path is None or not str(model_path).strip():
                    raise ValueError("engine_model_path must be set when engine_name='hf_causal_lm'")
                try:
                    from transformers import AutoModelForCausalLM
                except ImportError as e:
                    raise ImportError("HF engine requires transformers to be installed.") from e

                dtype = _resolve_torch_dtype(config.engine_dtype)
                load_kwargs: dict[str, Any] = {
                    "trust_remote_code": bool(config.engine_trust_remote_code),
                    "dtype": dtype,
                }
                if config.engine_device_map is not None:
                    load_kwargs["device_map"] = str(config.engine_device_map)

                self._hf_root_model = AutoModelForCausalLM.from_pretrained(str(model_path), **load_kwargs)
            else:
                self._hf_root_model = model

            lm = getattr(self._hf_root_model, "language_model", None)
            if isinstance(lm, nn.Module):
                self.model = lm
            else:
                self.model = self._hf_root_model

            if config.engine_device_map is None:
                self.model = self.model.to(self.device)

            if config.engine_freeze_base_model:
                for p in self.model.parameters():
                    p.requires_grad = False

        # Initialize dual-complex encoder (if enabled)
        self.encoder: Optional[DualComplexEncoder] = None
        if config.use_dual_complex:
            self.encoder = DualComplexEncoder(
                vocab_size=vocab_size,
                hidden_size=hidden_size,
                use_timestamp_injection=False,  # Can be enabled later
                device=self.device,
            )

        # Initialize memory addressing (if enabled)
        self.memory: Optional[MemoryAddressing] = None
        if config.init_sierpinski:
            self.memory = MemoryAddressing(
                n_dim=config.fractal_dim,
                n_clusters=config.memory_n_clusters,
                sierpinski_depth=config.fractal_depth,
                sierpinski_seed=config.sierpinski_seed,
                device=self.device,
            )
            self.memory.initialize()

        # Optional hook-sidecars (DOCX p.44 minimal-effort path), for HF models
        if config.enable_wrapper_hooks and self.engine_name == "hf_causal_lm":
            # For toy engine, use the hidden_size parameter; for HF, infer from model
            if self.engine_name == "toy":
                hdim = hidden_size
            else:
                hdim = _infer_hidden_dim(self.model)
            if config.enable_dca_sidecar:
                self._hook_dca = DualComplexAdapter(
                    hidden_dim=int(hdim),
                    rank=int(config.dca_rank),
                    alpha_init=float(config.dca_alpha_init),
                    beta_init=float(config.dca_beta_init),
                ).to(self.device)
            if config.init_sierpinski:
                mem = build_memory_from_cfg(cfg=config, hidden_dim=int(hdim))
                if mem is not None:
                    self._hook_memory = mem.to(self.device)

        self._se3_projector: Optional[nn.Module] = None
        self._hook_pose_extractor: Optional[HookPoseExtractor] = None
        if config.enable_se3_clustering:
            # For toy engine, use the hidden_size parameter; for HF, infer from model
            if self.engine_name == "toy":
                hdim = hidden_size
            else:
                hdim = _infer_hidden_dim(self.model)
            if self.engine_name == "hf_causal_lm":
                # HF path: use projector for hidden states
                self._se3_projector = HiddenToDualQuaternion(int(hdim)).to(self.device)
            elif config.enable_wrapper_hooks:
                # Hook path: use pose extractor
                self._hook_pose_extractor = HookPoseExtractor(
                    hidden_dim=int(hdim),
                    device=self.device,
                    enabled=True,
                )

        # Initialize Genesis step (if enabled)
        self.genesis: Optional[GenesisStep] = None
        self.genesis_scheduler: Optional[GenesisScheduler] = None
        if config.enable_se3_clustering:
            self.genesis = GenesisStep(
                buffer_size=config.genesis_buffer_size,
                k_medoids_k=config.k_medoids_k,
                k_medoids_max_iter=config.k_medoids_max_iter,
                k_medoids_tol=config.k_medoids_tol,
                w_rot=config.w_rot,
                w_trans=config.w_trans,
                device=self.device,
            )
            # Initialize Genesis scheduler for warm-up scheduling
            self.genesis_scheduler = GenesisScheduler(
                warmup_steps=config.genesis_warmup_steps,
                genesis_interval_steps=config.genesis_interval_steps,
                gradual_enablement=config.genesis_gradual_enablement,
            )

        # Initialize loss assembly
        self.loss_fn = LossAssembly(
            primal_loss_type=config.primal_loss_type,
            dual_loss_weight=config.dual_loss_weight,
            reduction="mean",
        )

        # Optimizer: train sidecars if base model is frozen (mode A), otherwise train all params.
        trainable_params: list[torch.nn.Parameter] = []
        if self.engine_name == "hf_causal_lm" and config.engine_freeze_base_model:
            if self._hook_dca is not None:
                trainable_params.extend([p for p in self._hook_dca.parameters() if p.requires_grad])
            if self._hook_memory is not None:
                trainable_params.extend([p for p in self._hook_memory.parameters() if p.requires_grad])
            if self._se3_projector is not None:
                trainable_params.extend([p for p in self._se3_projector.parameters() if p.requires_grad])
        else:
            trainable_params.extend([p for p in self.model.parameters() if p.requires_grad])
            if self._hook_dca is not None:
                trainable_params.extend([p for p in self._hook_dca.parameters() if p.requires_grad])
            if self._hook_memory is not None:
                trainable_params.extend([p for p in self._hook_memory.parameters() if p.requires_grad])
            if self._se3_projector is not None:
                trainable_params.extend([p for p in self._se3_projector.parameters() if p.requires_grad])

        if trainable_params:
            self.optimizer = torch.optim.AdamW(
                trainable_params,
                lr=float(config.optimizer_lr),
                weight_decay=float(config.optimizer_weight_decay),
            )

    def save_hook_memory(self, prefix: str) -> Optional[dict[str, str]]:
        if self._hook_memory is None:
            return None
        if hasattr(self._hook_memory, "save"):
            self._hook_memory.save(prefix)  # type: ignore[call-arg]
            return {"single": str(prefix)}
        if isinstance(self._hook_memory, nn.Module) and self._hook_memory.__class__.__name__ == "FractalMemoryBanks":
            return save_adid_banks(self._hook_memory, prefix)  # type: ignore[arg-type]
        return None

    def load_hook_memory(self, prefix: str, *, strict: bool = True) -> Optional[dict[str, str]]:
        if self._hook_memory is None:
            return None
        if hasattr(self._hook_memory, "load"):
            self._hook_memory.load(prefix, strict=strict)  # type: ignore[call-arg]
            return {"single": str(prefix)}
        if isinstance(self._hook_memory, nn.Module) and self._hook_memory.__class__.__name__ == "FractalMemoryBanks":
            return load_adid_banks(self._hook_memory, prefix, strict=strict)  # type: ignore[arg-type]
        return None

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
        timestamps: Optional[torch.Tensor] = None,
        adid_context: Optional[ADIDContext] = None,
    ) -> Union[torch.Tensor, DualComplexTensor]:
        """
        Forward pass through full pipeline.

        Args:
            input_ids: Token IDs tensor (batch_size, seq_len).
            attention_mask: Optional attention mask tensor (batch_size, seq_len).
            timestamps: Optional timestamps tensor (batch_size, seq_len).

        Returns:
            Logits tensor (batch_size, seq_len, vocab_size) or DualComplexTensor if use_dual_complex=True.
        """
        if self.engine_name == "hf_causal_lm":
            if attention_mask is None:
                attention_mask = torch.ones_like(input_ids, device=input_ids.device)

            forward_kwargs: dict[str, Any] = {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "use_cache": False,
                "output_hidden_states": bool(self.config.enable_se3_clustering or self.config.init_sierpinski),
                "return_dict": True,
            }
            forward_kwargs = _filter_kwargs_by_signature(self.model.forward, forward_kwargs)

            if self.config.enable_wrapper_hooks:
                with AuroraHookSession(
                    base_model=self.model,
                    cfg=self.config,
                    dca=self._hook_dca,
                    fmb=self._hook_memory,
                    adid_context=adid_context,
                ):
                    out_raw = self.model(**forward_kwargs)
            else:
                out_raw = self.model(**forward_kwargs)

            out = _extract_hf_outputs(out_raw)
            logits = out.logits
            embeddings = None
            if self.config.enable_se3_clustering and self.genesis is not None:
                # HF path: extract from hidden_states
                if self._se3_projector is not None:
                    if out.hidden_states is None or len(out.hidden_states) < 1:
                        raise RuntimeError(
                            "enable_se3_clustering requires output_hidden_states=True and non-empty hidden_states."
                        )
                    hs = out.hidden_states[-1]
                    if not torch.is_tensor(hs) or hs.ndim != 3:
                        raise RuntimeError(f"Unexpected HF hidden_states[-1] shape: {getattr(hs, 'shape', None)}")
                    embeddings = self._se3_projector(hs).detach()
                # Hook path: extract from pose buffer
                elif self._hook_pose_extractor is not None:
                    buffered_poses = self._hook_pose_extractor.get_buffered_poses()
                    if buffered_poses is not None:
                        # Reshape to (B, T, 8) for consistency with HF path
                        # For hook path, we accumulate across layers, so we treat as single batch
                        embeddings = buffered_poses.unsqueeze(0)  # (1, N, 8)
                        self._hook_pose_extractor.clear_buffer()
                    else:
                        embeddings = None
                else:
                    embeddings = None
        else:
            # Step 1: Dual-complex encode (if enabled)
            if self.config.use_dual_complex and self.encoder is not None:
                embeddings = self.encoder(input_ids, timestamps=timestamps)
            else:
                # Standard embedding (simplified for MVP)
                batch_size, seq_len = input_ids.shape
                hidden_size = self.encoder.hidden_size if (self.encoder is not None) else 128
                embeddings = torch.randn(batch_size, seq_len, hidden_size, device=self.device, dtype=torch.float32)

            # Step 2: Memory addressing (if enabled)
            if self.config.init_sierpinski and self.memory is not None:
                _assignments, _distances = self.memory.assign_to_centroids(embeddings)

            # Step 3: Model forward pass (toy MLP expects flattened embeddings)
            if isinstance(embeddings, DualComplexTensor):
                embeddings_for_model = embeddings.primal
            else:
                embeddings_for_model = embeddings

            batch_size, seq_len, hidden_size = embeddings_for_model.shape
            embeddings_flat = embeddings_for_model.view(batch_size * seq_len, hidden_size)
            logits_flat = self.model(embeddings_flat)  # (batch*seq, vocab)
            logits = logits_flat.view(batch_size, seq_len, -1)  # (batch, seq, vocab)

        # Step 4: Accumulate in Genesis buffer (if enabled)
        if self.config.enable_se3_clustering and self.genesis is not None and embeddings is not None:
            self.genesis.add_to_buffer(embeddings)

        # Return logits (wrap in DualComplexTensor if dual-complex mode)
        if self.config.use_dual_complex:
            # For MVP, create dual component as zeros (in real usage, model would produce dual logits)
            dual_logits = torch.zeros_like(logits)
            return DualComplexTensor(_stack(logits, dual_logits))
        else:
            return logits

    def loss(
        self,
        logits: Union[torch.Tensor, DualComplexTensor],
        labels: torch.Tensor,
        target_velocities: Optional[torch.Tensor] = None,
    ) -> tuple[torch.Tensor, dict[str, float]]:
        """
        Compute loss: primal + optional dual.

        Args:
            logits: Logits tensor from forward pass.
            labels: Target labels tensor (batch_size, seq_len).
            target_velocities: Optional target velocities for dual loss.

        Returns:
            Tuple of (total_loss, loss_dict).
        """
        total_loss, loss_dict = self.loss_fn(logits, labels, target_velocities=target_velocities)

        # Check finite loss
        check_finite_tensor(total_loss, "total_loss")

        return total_loss, loss_dict

    def step(
        self,
        input_ids: torch.Tensor,
        labels: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
        timestamps: Optional[torch.Tensor] = None,
        target_velocities: Optional[torch.Tensor] = None,
        adid_context: Optional[ADIDContext] = None,
    ) -> dict[str, float]:
        """
        Single training step: forward + loss + backprop + optional Genesis step.

        Args:
            input_ids: Token IDs tensor (batch_size, seq_len).
            labels: Target labels tensor (batch_size, seq_len).
            attention_mask: Optional attention mask tensor (batch_size, seq_len).
            timestamps: Optional timestamps tensor (batch_size, seq_len).
            target_velocities: Optional target velocities for dual loss.

        Returns:
            Dictionary with loss values and step metadata.
        """
        # Forward pass
        logits = self.forward(
            input_ids, attention_mask=attention_mask, timestamps=timestamps, adid_context=adid_context
        )

        # Check finite logits
        if isinstance(logits, DualComplexTensor):
            check_finite_tensor(logits.primal, "logits_primal")
            if self.config.dual_loss_weight > 0:
                check_finite_tensor(logits.dual, "logits_dual")
        else:
            check_finite_tensor(logits, "logits")

        # Compute loss
        loss, loss_dict = self.loss(logits, labels, target_velocities=target_velocities)

        # Backward pass (zero grads before backward so grads remain visible after the step)
        if self.optimizer is not None:
            self.optimizer.zero_grad(set_to_none=True)
        loss.backward()
        if self.optimizer is not None:
            self.optimizer.step()

        loss_dict["genesis_ran"] = 0.0
        # Optional Genesis step (if enabled, scheduler allows it, and interval reached)
        if (
            self.config.enable_se3_clustering
            and self.genesis is not None
            and self.genesis_scheduler is not None
            and self.step_count > 0
            and self.genesis_scheduler.should_enable_genesis(self.step_count)
            and self.genesis.should_trigger()
        ):
            medoids, _labels_genesis, genesis_metrics, gate_decision = self.genesis.run(
                return_metrics=True,
                gate_thresholds=None,  # TODO: Add gate thresholds to config
            )
            
            # Log Genesis metrics if available
            if genesis_metrics is not None:
                # Store metrics for later logging/reporting
                # TODO: Add metrics to training logs/artifacts
                pass
            
            # Handle gate decision
            if gate_decision is not None and gate_decision.promote:
                # Promote medoids to memory banks if gate says so
                # TODO: Implement promotion logic
                pass
            loss_dict["genesis_ran"] = 1.0
            if self.memory is not None:
                _ = medoids

        self.step_count += 1

        # Add step metadata
        loss_dict["step"] = self.step_count
        return loss_dict
