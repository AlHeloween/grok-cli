from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional


@dataclass(frozen=True)
class NavigationSettings:
    """Navigation paradigm configuration."""
    enabled: bool = False
    tau: float = 0.1
    max_depth: int = 7
    max_nodes: int = 4
    window_size: int = 2048
    k_read: int = 8


@dataclass(frozen=True)
class GPUMetricsSettings:
    """GPU metrics collection configuration."""
    enabled: bool = False


@dataclass(frozen=True)
class BuildSettings:
    """Build and compilation configuration."""
    nvcc_ccbin: str = ""
    nvptx_toolchain: str = "nightly-2024-09-05"


@dataclass(frozen=True)
class PathSettings:
    """Path configuration."""
    bitnet_gguf: Optional[str] = None
    bitnet_dir: Optional[str] = None
    llama_cli: Optional[str] = None
    text_model: Optional[str] = None
    deepseek_vl_model: Optional[str] = None
    litert_model: Optional[str] = None
    engine_model: Optional[str] = None
    wiki_dataset_dir: Optional[str] = None


@dataclass(frozen=True)
class AuroraSettings:
    """Complete Aurora configuration from settings.json."""
    paths: PathSettings
    navigation: NavigationSettings
    gpu_metrics: GPUMetricsSettings
    build: BuildSettings
    
    # Backward compatibility: direct access to common paths
    @property
    def bitnet_gguf(self) -> Optional[str]:
        """Backward compatibility: access paths.bitnet_gguf directly."""
        return self.paths.bitnet_gguf
    
    @property
    def wiki_dataset_dir(self) -> Optional[str]:
        """Backward compatibility: access paths.wiki_dataset_dir directly."""
        return self.paths.wiki_dataset_dir


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_settings(*, path: Optional[str] = None) -> AuroraSettings:
    """
    Load repo-local settings from `settings.json`.

    This is intentionally minimal: it's a convenience for local paths so we don't
    require `setx ...` environment variables for every run.
    
    Priority: settings.json > environment variable > default
    """

    p = Path(path) if path is not None else (_repo_root() / "settings.json")
    
    # Default values
    default_paths = PathSettings()
    default_navigation = NavigationSettings()
    default_gpu_metrics = GPUMetricsSettings()
    default_build = BuildSettings()
    
    if not p.exists():
        return AuroraSettings(
            paths=default_paths,
            navigation=default_navigation,
            gpu_metrics=default_gpu_metrics,
            build=default_build,
        )
    
    raw = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise TypeError("settings.json must contain a JSON object")

    # Parse paths
    paths_dict = raw.get("paths", {})
    if paths_dict is None:
        paths_dict = {}
    if not isinstance(paths_dict, dict):
        raise TypeError("settings.json['paths'] must be an object")
    
    paths = PathSettings(
        bitnet_gguf=_str_or_none(paths_dict.get("bitnet_gguf")),
        bitnet_dir=_str_or_none(paths_dict.get("bitnet_dir")),
        llama_cli=_str_or_none(paths_dict.get("llama_cli")),
        text_model=_str_or_none(paths_dict.get("text_model")),
        deepseek_vl_model=_str_or_none(paths_dict.get("deepseek_vl_model")),
        litert_model=_str_or_none(paths_dict.get("litert_model")),
        engine_model=_str_or_none(paths_dict.get("engine_model")),
        wiki_dataset_dir=_str_or_none(paths_dict.get("wiki_dataset_dir")),
    )
    
    # Parse navigation
    nav_dict = raw.get("navigation", {})
    if nav_dict is None:
        nav_dict = {}
    if not isinstance(nav_dict, dict):
        raise TypeError("settings.json['navigation'] must be an object")
    
    navigation = NavigationSettings(
        enabled=bool(nav_dict.get("enabled", default_navigation.enabled)),
        tau=float(nav_dict.get("tau", default_navigation.tau)),
        max_depth=int(nav_dict.get("max_depth", default_navigation.max_depth)),
        max_nodes=int(nav_dict.get("max_nodes", default_navigation.max_nodes)),
        window_size=int(nav_dict.get("window_size", default_navigation.window_size)),
        k_read=int(nav_dict.get("k_read", default_navigation.k_read)),
    )
    
    # Parse GPU metrics
    gpu_dict = raw.get("gpu_metrics", {})
    if gpu_dict is None:
        gpu_dict = {}
    if not isinstance(gpu_dict, dict):
        raise TypeError("settings.json['gpu_metrics'] must be an object")
    
    gpu_metrics = GPUMetricsSettings(
        enabled=bool(gpu_dict.get("enabled", default_gpu_metrics.enabled)),
    )
    
    # Parse build
    build_dict = raw.get("build", {})
    if build_dict is None:
        build_dict = {}
    if not isinstance(build_dict, dict):
        raise TypeError("settings.json['build'] must be an object")
    
    build = BuildSettings(
        nvcc_ccbin=_str_or_none(build_dict.get("nvcc_ccbin")) or default_build.nvcc_ccbin,
        nvptx_toolchain=_str_or_none(build_dict.get("nvptx_toolchain")) or default_build.nvptx_toolchain,
    )
    
    return AuroraSettings(
        paths=paths,
        navigation=navigation,
        gpu_metrics=gpu_metrics,
        build=build,
    )


def _str_or_none(value: Any) -> Optional[str]:
    """Convert value to string or None."""
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def get_setting(key: str, default: Any = None) -> Any:
    """
    Get setting with environment variable fallback.
    
    Priority: settings.json > environment variable > default
    
    Args:
        key: Setting key (e.g., "paths.bitnet_gguf" or "navigation.enabled")
        default: Default value if not found
    
    Returns:
        Setting value or default
    """
    settings = load_settings()
    
    # Handle nested keys (e.g., "paths.bitnet_gguf")
    parts = key.split(".", 1)
    if len(parts) == 1:
        # Simple key - check environment variable first
        env_value = os.environ.get(f"AURORA_{key.upper()}")
        if env_value is not None:
            return env_value
        # Then check settings (would need to access attribute)
        return default
    else:
        # Nested key
        section, subkey = parts
        env_key = f"AURORA_{section.upper()}_{subkey.upper()}"
        env_value = os.environ.get(env_key)
        if env_value is not None:
            return env_value
        
        # Get from settings
        section_obj = getattr(settings, section, None)
        if section_obj is not None:
            return getattr(section_obj, subkey, default)
        return default


def get_path(key: str) -> Optional[str]:
    """
    Get path setting with environment variable fallback.
    
    Priority: settings.json > environment variable > None
    
    Args:
        key: Path key (e.g., "bitnet_gguf", "bitnet_dir")
    
    Returns:
        Path string or None
    """
    settings = load_settings()
    
    # Check environment variable first
    env_key = f"AURORA_{key.upper()}"
    env_value = os.environ.get(env_key)
    if env_value:
        return env_value.strip()
    
    # Then check settings.json
    path_value = getattr(settings.paths, key, None)
    if path_value:
        return path_value
    
    return None


def get_navigation_config() -> NavigationSettings:
    """
    Get navigation configuration with environment variable fallback.
    
    Priority: settings.json > environment variable > default
    """
    settings = load_settings()
    
    # Check environment variables
    enabled_env = os.environ.get("AURORA_ENABLE_NAVIGATION", "").strip().lower()
    enabled = enabled_env in ("1", "true") if enabled_env else settings.navigation.enabled
    
    tau = float(os.environ.get("AURORA_NAV_TAU", str(settings.navigation.tau)))
    max_depth = int(os.environ.get("AURORA_NAV_MAX_DEPTH", str(settings.navigation.max_depth)))
    max_nodes = int(os.environ.get("AURORA_NAV_MAX_NODES", str(settings.navigation.max_nodes)))
    window_size = int(os.environ.get("AURORA_WINDOW_SIZE", str(settings.navigation.window_size)))
    k_read = int(os.environ.get("AURORA_K_READ", str(settings.navigation.k_read)))
    
    return NavigationSettings(
        enabled=enabled,
        tau=tau,
        max_depth=max_depth,
        max_nodes=max_nodes,
        window_size=window_size,
        k_read=k_read,
    )


def get_gpu_metrics_config() -> GPUMetricsSettings:
    """
    Get GPU metrics configuration with environment variable fallback.
    
    Priority: settings.json > environment variable > default
    """
    settings = load_settings()
    
    # Check environment variable
    enabled_env = os.environ.get("AURORA_ENABLE_GPU_METRICS", "").strip().lower()
    enabled = enabled_env in ("1", "true") if enabled_env else settings.gpu_metrics.enabled
    
    return GPUMetricsSettings(enabled=enabled)

