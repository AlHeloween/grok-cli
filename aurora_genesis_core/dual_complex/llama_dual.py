"""
Dual-complex (dual-phasor) retrofit for HuggingFace LLaMA blocks.

Design goal:
- Build a dual-complex forward path for LLaMA that can be constructed from an
  existing `transformers.LlamaForCausalLM` model (weights copied into primal
  complex weights; dual weights initialized to zero).

Representation:
- Hidden states are represented as `DualComplexTensor` where primal/dual are
  complex tensors (typically imag=0 initially).

NOTE:
- This is a bring-up path aimed at correctness and explicitness. It does not
  implement KV-cache integration yet.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Union

import torch
from torch import nn

from .torch_backend import DualComplexLinear, DualComplexTensor, dual_silu


def _stack(primal: torch.Tensor, dual: torch.Tensor) -> torch.Tensor:
    return torch.stack([primal, dual], dim=-1)


def lift_real_to_dual_complex(x: torch.Tensor, *, complex_dtype: torch.dtype = torch.complex64) -> DualComplexTensor:
    if torch.is_complex(x):
        primal = x.to(dtype=complex_dtype)
    else:
        primal = x.to(dtype=complex_dtype)
    dual = torch.zeros_like(primal)
    return DualComplexTensor(_stack(primal, dual))


def dual_softmax_primal_jvp(scores_primal: torch.Tensor, scores_dual: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """
    Dual-softmax via Jacobian-vector product:
      p = softmax(s)
      dp = J_softmax(s) * ds

    Identity: dp = p * (ds - sum(p*ds)).
    """
    p = torch.softmax(scores_primal, dim=-1)
    dot = (p * scores_dual).sum(dim=-1, keepdim=True)
    dp = p * (scores_dual - dot)
    return p, dp


def _repeat_kv(hidden_states: torch.Tensor, n_rep: int) -> torch.Tensor:
    # hidden_states: [b, n_kv, s, d]
    if n_rep == 1:
        return hidden_states
    b, n_kv, s, d = hidden_states.shape
    hidden_states = hidden_states[:, :, None, :, :].expand(b, n_kv, n_rep, s, d)
    return hidden_states.reshape(b, n_kv * n_rep, s, d)


def _rotate_half(x: torch.Tensor) -> torch.Tensor:
    # last dim must be even
    d = x.shape[-1]
    x1 = x[..., : d // 2]
    x2 = x[..., d // 2 :]
    return torch.cat((-x2, x1), dim=-1)


@dataclass(frozen=True)
class RotaryCache:
    cos: torch.Tensor  # [b, 1, s, d]
    sin: torch.Tensor  # [b, 1, s, d]


def rotary_cache(
    *,
    position_ids: torch.Tensor,  # [b, s]
    head_dim: int,
    theta: float = 10000.0,
    device: Any = None,
) -> RotaryCache:
    if head_dim % 2 != 0:
        raise ValueError(f"head_dim must be even for RoPE; got head_dim={head_dim}")
    inv_freq = 1.0 / (theta ** (torch.arange(0, head_dim, 2, device=device, dtype=torch.float32) / head_dim))
    freqs = torch.einsum("bs,d->bsd", position_ids.to(dtype=torch.float32), inv_freq)  # [b,s,d/2]
    cos = torch.cos(freqs)
    sin = torch.sin(freqs)
    # Expand to full dim by duplication
    cos_full = torch.cat([cos, cos], dim=-1)[:, None, :, :]  # [b,1,s,d]
    sin_full = torch.cat([sin, sin], dim=-1)[:, None, :, :]
    return RotaryCache(cos=cos_full, sin=sin_full)


def apply_rope(x: torch.Tensor, cache: RotaryCache) -> torch.Tensor:
    # x: [b,h,s,d] (complex ok); cache.cos/sin: [b,1,s,d] real
    return (x * cache.cos) + (_rotate_half(x) * cache.sin)


class DualRMSNorm(nn.Module):
    """
    Dual extension of RMSNorm.

    For primal:
      y_p = (x_p / rms(x_p)) * w
      rms(x_p) = sqrt(mean(|x_p|^2) + eps)

    For dual (directional derivative / dual extension):
      y_d = (x_d * inv_r) + x_p * d(inv_r)
      d(inv_r) = -0.5 * inv_r^3 * d(mean(|x_p|^2))
      d(mean(|x_p|^2)) = mean(2*Re(conj(x_p)*x_d))
    """

    def __init__(self, hidden_size: int, eps: float = 1e-6, *, device: Any = None, dtype: torch.dtype = torch.float32) -> None:
        super().__init__()
        self.eps = float(eps)
        self.weight = nn.Parameter(torch.ones((hidden_size,), device=device, dtype=dtype))

    @classmethod
    def from_hf(cls, rmsnorm: nn.Module) -> DualRMSNorm:
        # HF LlamaRMSNorm has .weight
        w = getattr(rmsnorm, "weight")
        m = cls(w.shape[0], eps=getattr(rmsnorm, "eps", 1e-6), device=w.device, dtype=w.dtype)
        with torch.no_grad():
            m.weight.copy_(w)
        return m

    def forward(self, x: DualComplexTensor) -> DualComplexTensor:
        xp = x.primal
        xd = x.dual

        ms = (xp.real * xp.real + xp.imag * xp.imag).mean(dim=-1, keepdim=True)  # real
        inv_r = torch.rsqrt(ms + self.eps)  # real

        # ds = mean(2*Re(conj(x)*dx))
        ds = (2.0 * torch.real(xp.conj() * xd)).mean(dim=-1, keepdim=True)  # real
        inv_r3 = inv_r * inv_r * inv_r
        d_inv_r = -0.5 * inv_r3 * ds  # real

        yp = xp * inv_r
        yd = (xd * inv_r) + (xp * d_inv_r)

        w = self.weight.to(dtype=yp.real.dtype)
        yp = yp * w
        yd = yd * w
        return DualComplexTensor(_stack(yp, yd))


class DualLlamaMLP(nn.Module):
    def __init__(self, gate: DualComplexLinear, up: DualComplexLinear, down: DualComplexLinear) -> None:
        super().__init__()
        self.gate_proj = gate
        self.up_proj = up
        self.down_proj = down

    @classmethod
    def from_hf(cls, mlp: nn.Module, *, complex_dtype: torch.dtype = torch.complex64) -> DualLlamaMLP:
        gate = DualComplexLinear(
            mlp.gate_proj.in_features,
            mlp.gate_proj.out_features,
            bias=mlp.gate_proj.bias is not None,
            enable_dual_weights=False,
            dtype=complex_dtype,
            device=mlp.gate_proj.weight.device,
        )
        up = DualComplexLinear(
            mlp.up_proj.in_features,
            mlp.up_proj.out_features,
            bias=mlp.up_proj.bias is not None,
            enable_dual_weights=False,
            dtype=complex_dtype,
            device=mlp.up_proj.weight.device,
        )
        down = DualComplexLinear(
            mlp.down_proj.in_features,
            mlp.down_proj.out_features,
            bias=mlp.down_proj.bias is not None,
            enable_dual_weights=False,
            dtype=complex_dtype,
            device=mlp.down_proj.weight.device,
        )

        def copy_linear(dst: DualComplexLinear, src: nn.Linear) -> None:
            with torch.no_grad():
                dst.weight_primal.real.copy_(src.weight.to(dtype=torch.float32))
                dst.weight_primal.imag.zero_()
                if dst.weight_dual is not None:
                    dst.weight_dual.zero_()
                if src.bias is not None and dst.bias_primal is not None:
                    dst.bias_primal.real.copy_(src.bias.to(dtype=torch.float32))
                    dst.bias_primal.imag.zero_()
                    if dst.bias_dual is not None:
                        dst.bias_dual.zero_()

        copy_linear(gate, mlp.gate_proj)
        copy_linear(up, mlp.up_proj)
        copy_linear(down, mlp.down_proj)
        return cls(gate=gate, up=up, down=down)

    def forward(self, x: DualComplexTensor) -> DualComplexTensor:
        g = dual_silu(self.gate_proj(x))
        u = self.up_proj(x)
        return self.down_proj(g * u)


class DualLlamaAttention(nn.Module):
    def __init__(
        self,
        q: DualComplexLinear,
        k: DualComplexLinear,
        v: DualComplexLinear,
        o: DualComplexLinear,
        *,
        num_heads: int,
        num_kv_heads: int,
        head_dim: int,
        rope_theta: float = 10000.0,
    ) -> None:
        super().__init__()
        self.q_proj = q
        self.k_proj = k
        self.v_proj = v
        self.o_proj = o
        self.num_heads = int(num_heads)
        self.num_kv_heads = int(num_kv_heads)
        self.head_dim = int(head_dim)
        self.num_kv_groups = self.num_heads // self.num_kv_heads
        self.scale = float(self.head_dim) ** 0.5
        self.rope_theta = float(rope_theta)

    @classmethod
    def from_hf(cls, attn: nn.Module, *, complex_dtype: torch.dtype = torch.complex64) -> DualLlamaAttention:
        # LlamaAttention: q_proj/k_proj/v_proj/o_proj, num_heads, head_dim, num_key_value_heads, rope_theta
        device = attn.q_proj.weight.device

        def make(src: nn.Linear) -> DualComplexLinear:
            dst = DualComplexLinear(
                src.in_features,
                src.out_features,
                bias=src.bias is not None,
                enable_dual_weights=False,
                dtype=complex_dtype,
                device=device,
            )
            with torch.no_grad():
                dst.weight_primal.real.copy_(src.weight.to(dtype=torch.float32))
                dst.weight_primal.imag.zero_()
                if dst.weight_dual is not None:
                    dst.weight_dual.zero_()
                if src.bias is not None and dst.bias_primal is not None:
                    dst.bias_primal.real.copy_(src.bias.to(dtype=torch.float32))
                    dst.bias_primal.imag.zero_()
                    if dst.bias_dual is not None:
                        dst.bias_dual.zero_()
            return dst

        q = make(attn.q_proj)
        k = make(attn.k_proj)
        v = make(attn.v_proj)
        o = make(attn.o_proj)

        cfg = getattr(attn, "config", None)
        if cfg is None:
            raise AttributeError("Expected HuggingFace LlamaAttention to expose `.config`.")

        num_heads = int(getattr(cfg, "num_attention_heads"))
        head_dim = int(getattr(attn, "head_dim", getattr(cfg, "head_dim", cfg.hidden_size // num_heads)))
        num_kv = int(getattr(cfg, "num_key_value_heads", num_heads))
        rope_theta = float(getattr(cfg, "rope_theta", 10000.0))
        return cls(q=q, k=k, v=v, o=o, num_heads=num_heads, num_kv_heads=num_kv, head_dim=head_dim, rope_theta=rope_theta)

    def forward(
        self,
        x: DualComplexTensor,
        *,
        attention_mask: Optional[torch.Tensor] = None,  # [b,1,1,s] or [b,1,s,s] additive
        position_ids: Optional[torch.Tensor] = None,  # [b,s]
    ) -> DualComplexTensor:
        bsz, seqlen, _ = x.primal.shape
        device = x.primal.device
        if position_ids is None:
            position_ids = torch.arange(seqlen, device=device, dtype=torch.long)[None, :].expand(bsz, seqlen)

        q = self.q_proj(x)
        k = self.k_proj(x)
        v = self.v_proj(x)

        def shape(t: torch.Tensor, heads: int) -> torch.Tensor:
            return t.view(bsz, seqlen, heads, self.head_dim).transpose(1, 2)  # [b,h,s,d]

        qp = shape(q.primal, self.num_heads)
        qd = shape(q.dual, self.num_heads)
        kp = shape(k.primal, self.num_kv_heads)
        kd = shape(k.dual, self.num_kv_heads)
        vp = shape(v.primal, self.num_kv_heads)
        vd = shape(v.dual, self.num_kv_heads)

        # RoPE on Q/K (primal and dual)
        cache = rotary_cache(position_ids=position_ids, head_dim=self.head_dim, theta=self.rope_theta, device=device)
        qp = apply_rope(qp, cache)
        qd = apply_rope(qd, cache)
        kp = apply_rope(kp, cache)
        kd = apply_rope(kd, cache)

        # Repeat KV heads if using GQA
        kp = _repeat_kv(kp, self.num_kv_groups)
        kd = _repeat_kv(kd, self.num_kv_groups)
        vp = _repeat_kv(vp, self.num_kv_groups)
        vd = _repeat_kv(vd, self.num_kv_groups)

        # scores_p = Re(Qp Kp^H) / sqrt(d)
        scores_p = torch.real(torch.einsum("bhqd,bhkd->bhqk", qp, kp.conj())) / self.scale  # [b,h,q,k]
        # scores_d = Re(Qd Kp^H + Qp Kd^H) / sqrt(d)
        scores_d = torch.real(
            torch.einsum("bhqd,bhkd->bhqk", qd, kp.conj()) + torch.einsum("bhqd,bhkd->bhqk", qp, kd.conj())
        ) / self.scale

        if attention_mask is None:
            # causal mask: allow attending to <= current position
            causal = torch.full((seqlen, seqlen), float("-inf"), device=device)
            causal = torch.triu(causal, diagonal=1)
            attention_mask = causal[None, None, :, :]  # [1,1,s,s]
        scores_p = scores_p + attention_mask

        p, dp = dual_softmax_primal_jvp(scores_p, scores_d)

        # Promote probabilities to complex for complex-valued value tensors.
        p_c = p.to(dtype=vp.dtype)
        dp_c = dp.to(dtype=vp.dtype)

        op = torch.einsum("bhqk,bhkd->bhqd", p_c, vp)
        od = torch.einsum("bhqk,bhkd->bhqd", p_c, vd) + torch.einsum("bhqk,bhkd->bhqd", dp_c, vp)

        # back to [b,s,h*d]
        op = op.transpose(1, 2).contiguous().view(bsz, seqlen, self.num_heads * self.head_dim)
        od = od.transpose(1, 2).contiguous().view(bsz, seqlen, self.num_heads * self.head_dim)
        out = DualComplexTensor(_stack(op, od))
        return self.o_proj(out)


class DualLlamaDecoderLayer(nn.Module):
    def __init__(self, *, norm1: DualRMSNorm, attn: DualLlamaAttention, norm2: DualRMSNorm, mlp: DualLlamaMLP) -> None:
        super().__init__()
        self.input_layernorm = norm1
        self.self_attn = attn
        self.post_attention_layernorm = norm2
        self.mlp = mlp

    @classmethod
    def from_hf(cls, layer: nn.Module, *, complex_dtype: torch.dtype = torch.complex64) -> DualLlamaDecoderLayer:
        norm1 = DualRMSNorm.from_hf(layer.input_layernorm)
        norm2 = DualRMSNorm.from_hf(layer.post_attention_layernorm)
        attn = DualLlamaAttention.from_hf(layer.self_attn, complex_dtype=complex_dtype)
        mlp = DualLlamaMLP.from_hf(layer.mlp, complex_dtype=complex_dtype)
        return cls(norm1=norm1, attn=attn, norm2=norm2, mlp=mlp)

    def forward(
        self,
        x: DualComplexTensor,
        *,
        attention_mask: Optional[torch.Tensor] = None,
        position_ids: Optional[torch.Tensor] = None,
    ) -> DualComplexTensor:
        h = self.input_layernorm(x)
        a = self.self_attn(h, attention_mask=attention_mask, position_ids=position_ids)
        x = x + a
        h2 = self.post_attention_layernorm(x)
        m = self.mlp(h2)
        return x + m


class DualLlamaModel(nn.Module):
    def __init__(
        self,
        *,
        layers: nn.ModuleList,
        norm: DualRMSNorm,
        hidden_size: int,
    ) -> None:
        super().__init__()
        self.layers = layers
        self.norm = norm
        self.hidden_size = int(hidden_size)

    @classmethod
    def from_hf(cls, llama_model: nn.Module, *, complex_dtype: torch.dtype = torch.complex64) -> DualLlamaModel:
        # llama_model: transformers LlamaModel at llama_for_causal_lm.model
        layers = nn.ModuleList([DualLlamaDecoderLayer.from_hf(l, complex_dtype=complex_dtype) for l in llama_model.layers])
        norm = DualRMSNorm.from_hf(llama_model.norm)
        return cls(layers=layers, norm=norm, hidden_size=llama_model.config.hidden_size)

    def forward(
        self,
        x: DualComplexTensor,
        *,
        attention_mask: Optional[torch.Tensor] = None,
        position_ids: Optional[torch.Tensor] = None,
    ) -> DualComplexTensor:
        for layer in self.layers:
            x = layer(x, attention_mask=attention_mask, position_ids=position_ids)
        return self.norm(x)


class DualLlamaForCausalLM(nn.Module):
    """
    Dual-complex LLaMA Causal LM constructed from HF weights.

    Input:
      - `inputs_embeds` as real float tensor [b,s,h] OR DualComplexTensor.
    Output:
      - `logits_primal`: real float logits [b,s,vocab]
      - `logits_dual`: real float dual logits [b,s,vocab] (optional; returned)
    """

    def __init__(self, *, model: DualLlamaModel, lm_head: DualComplexLinear) -> None:
        super().__init__()
        self.model = model
        self.lm_head = lm_head

    @classmethod
    def from_hf(cls, llama_for_causal_lm: nn.Module, *, complex_dtype: torch.dtype = torch.complex64) -> DualLlamaForCausalLM:
        model = DualLlamaModel.from_hf(llama_for_causal_lm.model, complex_dtype=complex_dtype)

        # lm_head is Linear(hidden -> vocab) (bias usually False)
        src = llama_for_causal_lm.lm_head
        dst = DualComplexLinear(
            src.in_features,
            src.out_features,
            bias=src.bias is not None,
            enable_dual_weights=False,
            dtype=complex_dtype,
            device=src.weight.device,
        )
        with torch.no_grad():
            dst.weight_primal.real.copy_(src.weight.to(dtype=torch.float32))
            dst.weight_primal.imag.zero_()
            if dst.weight_dual is not None:
                dst.weight_dual.zero_()
            if src.bias is not None and dst.bias_primal is not None:
                dst.bias_primal.real.copy_(src.bias.to(dtype=torch.float32))
                dst.bias_primal.imag.zero_()
                if dst.bias_dual is not None:
                    dst.bias_dual.zero_()
        return cls(model=model, lm_head=dst)

    def forward(
        self,
        *,
        inputs_embeds: Union[torch.Tensor, DualComplexTensor],
        attention_mask: Optional[torch.Tensor] = None,
        position_ids: Optional[torch.Tensor] = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        if isinstance(inputs_embeds, DualComplexTensor):
            x = inputs_embeds
        else:
            x = lift_real_to_dual_complex(inputs_embeds)
        h = self.model(x, attention_mask=attention_mask, position_ids=position_ids)
        out = self.lm_head(h)
        logits_p = torch.real(out.primal)
        logits_d = torch.real(out.dual)
        return logits_p, logits_d

