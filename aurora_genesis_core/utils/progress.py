"""Progress indicators and verbose output utilities for tests."""

from __future__ import annotations

import sys
import time
from typing import Callable, Optional


def log(message: str, flush: bool = True) -> None:
    """Log message with timestamp and flush immediately."""
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}", flush=flush)


def log_step(step_num: int, total: int, message: str, flush: bool = True) -> None:
    """Log step with progress indicator."""
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] [{step_num}/{total}] {message}", flush=flush)


def log_progress(current: int, total: int, prefix: str = "Progress", flush: bool = True) -> None:
    """Log progress percentage."""
    pct = (current / total * 100) if total > 0 else 0
    print(f"\r{prefix}: {current}/{total} ({pct:.1f}%)", end="", flush=flush)
    if current >= total:
        print()  # New line when complete


def log_dot(flush: bool = True) -> None:
    """Log a dot for progress indication."""
    print(".", end="", flush=flush)


def log_elapsed(start_time: float, message: str = "Elapsed", flush: bool = True) -> None:
    """Log elapsed time."""
    elapsed = time.perf_counter() - start_time
    log(f"{message}: {elapsed:.3f}s", flush=flush)


class ProgressTracker:
    """Track progress with timestamps and elapsed time."""
    
    def __init__(self, name: str, verbose: bool = True):
        self.name = name
        self.verbose = verbose
        self.start_time = time.perf_counter()
        self.last_checkpoint = self.start_time
        self.current_phase = None
        self.phase_start_time = None
        
        if self.verbose:
            log(f"Starting: {self.name}")
    
    def checkpoint(self, message: str) -> None:
        """Log a checkpoint with elapsed time."""
        if not self.verbose:
            return
        
        elapsed = time.perf_counter() - self.last_checkpoint
        total_elapsed = time.perf_counter() - self.start_time
        log(f"  {message} (+{elapsed:.3f}s, total: {total_elapsed:.3f}s)")
        self.last_checkpoint = time.perf_counter()
    
    def start_phase(self, phase_name: str, total_steps: int = 1) -> None:
        """Start a new phase with optional step count."""
        self.current_phase = phase_name
        self.phase_start_time = time.perf_counter()
        self.phase_total_steps = total_steps
        self.phase_current_step = 0
        
        if self.verbose:
            log(f"Starting phase: {phase_name} ({total_steps} steps)")
    
    def update(self, message: str) -> None:
        """Update progress within current phase."""
        self.phase_current_step += 1
        if self.verbose:
            if self.current_phase:
                log(f"  [{self.phase_current_step}/{self.phase_total_steps}] {message}")
            else:
                log(f"  {message}")
    
    def complete_phase(self) -> None:
        """Complete current phase."""
        if self.current_phase and self.verbose:
            phase_elapsed = time.perf_counter() - self.phase_start_time
            total_elapsed = time.perf_counter() - self.start_time
            log(f"Completed phase: {self.current_phase} (+{phase_elapsed:.3f}s, total: {total_elapsed:.3f}s)")
        
        self.current_phase = None
        self.phase_start_time = None
    
    def finish(self, message: Optional[str] = None) -> float:
        """Finish tracking and return total elapsed time."""
        if self.current_phase:
            self.complete_phase()
        
        total_elapsed = time.perf_counter() - self.start_time
        
        if self.verbose:
            msg = message or f"Completed: {self.name}"
            log(f"{msg} (total: {total_elapsed:.3f}s)")
        
        return total_elapsed


def with_progress_indicator(
    operation: Callable,
    message: str = "Processing",
    verbose: bool = True,
) -> Callable:
    """Decorator to add progress indicator to an operation."""
    def wrapper(*args, **kwargs):
        if verbose:
            log(f"{message}...")
        
        start = time.perf_counter()
        try:
            result = operation(*args, **kwargs)
            elapsed = time.perf_counter() - start
            
            if verbose:
                log(f"✓ {message} completed ({elapsed:.3f}s)")
            
            return result
        except Exception as e:
            elapsed = time.perf_counter() - start
            if verbose:
                log(f"✗ {message} failed after {elapsed:.3f}s: {e}")
            raise
    
    return wrapper


def print_separator(char: str = "=", width: int = 80, flush: bool = True) -> None:
    """Print a separator line."""
    print(char * width, flush=flush)
