"""Performance profiler for Navigation paradigm operations."""

from __future__ import annotations

import time
from typing import Dict, Optional, List
from collections import defaultdict
import torch


class NavigationProfiler:
    """
    Performance profiler for Navigation paradigm operations.
    
    Tracks:
    - Operation timings
    - Memory access patterns
    - Cache hit/miss rates
    - FLOPs estimates
    """
    
    def __init__(self, enabled: bool = True):
        """
        Initialize profiler.
        
        Args:
            enabled: If True, enable profiling
        """
        self.enabled = enabled
        self.timings: Dict[str, List[float]] = defaultdict(list)
        self.counts: Dict[str, int] = defaultdict(int)
        self.memory_accesses: Dict[str, int] = defaultdict(int)
        self.cache_stats: Dict[str, Dict[str, int]] = defaultdict(lambda: {"hits": 0, "misses": 0})
    
    def start_timer(self, operation: str) -> float:
        """
        Start timing an operation.
        
        Args:
            operation: Operation name
            
        Returns:
            Start time
        """
        if not self.enabled:
            return 0.0
        
        start_time = time.perf_counter()
        self.timings[f"{operation}_start"].append(start_time)
        return start_time
    
    def end_timer(self, operation: str, start_time: float) -> float:
        """
        End timing an operation.
        
        Args:
            operation: Operation name
            start_time: Start time from start_timer()
            
        Returns:
            Elapsed time in seconds
        """
        if not self.enabled:
            return 0.0
        
        end_time = time.perf_counter()
        elapsed = end_time - start_time
        self.timings[operation].append(elapsed)
        self.counts[operation] += 1
        return elapsed
    
    def record_memory_access(self, operation: str, bytes_accessed: int) -> None:
        """
        Record memory access.
        
        Args:
            operation: Operation name
            bytes_accessed: Number of bytes accessed
        """
        if not self.enabled:
            return
        
        self.memory_accesses[operation] += bytes_accessed
    
    def record_cache_hit(self, cache_name: str) -> None:
        """Record cache hit."""
        if not self.enabled:
            return
        
        self.cache_stats[cache_name]["hits"] += 1
    
    def record_cache_miss(self, cache_name: str) -> None:
        """Record cache miss."""
        if not self.enabled:
            return
        
        self.cache_stats[cache_name]["misses"] += 1
    
    def get_stats(self) -> Dict[str, any]:
        """
        Get profiling statistics.
        
        Returns:
            Dictionary with statistics
        """
        if not self.enabled:
            return {}
        
        stats = {
            "timings": {},
            "counts": {},
            "memory_accesses": dict(self.memory_accesses),
            "cache_stats": dict(self.cache_stats),
        }
        
        # Compute timing statistics
        for operation, times in self.timings.items():
            if not operation.endswith("_start"):
                if times:
                    stats["timings"][operation] = {
                        "mean": sum(times) / len(times),
                        "min": min(times),
                        "max": max(times),
                        "total": sum(times),
                        "count": len(times),
                    }
        
        # Add counts
        stats["counts"] = dict(self.counts)
        
        return stats
    
    def reset(self) -> None:
        """Reset all profiling data."""
        self.timings.clear()
        self.counts.clear()
        self.memory_accesses.clear()
        self.cache_stats.clear()
    
    def print_summary(self) -> None:
        """Print profiling summary."""
        if not self.enabled:
            return
        
        stats = self.get_stats()
        
        print("=" * 80)
        print("NAVIGATION PARADIGM PROFILING SUMMARY")
        print("=" * 80)
        
        # Timings
        if stats["timings"]:
            print("\nOperation Timings:")
            for op, timing_stats in stats["timings"].items():
                print(f"  {op}:")
                print(f"    Mean: {timing_stats['mean']*1000:.3f} ms")
                print(f"    Min:  {timing_stats['min']*1000:.3f} ms")
                print(f"    Max:  {timing_stats['max']*1000:.3f} ms")
                print(f"    Total: {timing_stats['total']*1000:.3f} ms ({timing_stats['count']} calls)")
        
        # Memory accesses
        if stats["memory_accesses"]:
            print("\nMemory Accesses:")
            for op, bytes_accessed in stats["memory_accesses"].items():
                mb = bytes_accessed / (1024 * 1024)
                print(f"  {op}: {mb:.2f} MB")
        
        # Cache stats
        if stats["cache_stats"]:
            print("\nCache Statistics:")
            for cache_name, cache_stat in stats["cache_stats"].items():
                hits = cache_stat["hits"]
                misses = cache_stat["misses"]
                total = hits + misses
                hit_rate = (hits / total * 100.0) if total > 0 else 0.0
                print(f"  {cache_name}:")
                print(f"    Hits: {hits} ({hit_rate:.1f}%)")
                print(f"    Misses: {misses} ({100.0 - hit_rate:.1f}%)")
        
        print("=" * 80)


# Global profiler instance
_global_profiler: Optional[NavigationProfiler] = None


def get_profiler() -> NavigationProfiler:
    """Get global profiler instance."""
    global _global_profiler
    if _global_profiler is None:
        _global_profiler = NavigationProfiler(enabled=True)
    return _global_profiler


def set_profiler(profiler: NavigationProfiler) -> None:
    """Set global profiler instance."""
    global _global_profiler
    _global_profiler = profiler
