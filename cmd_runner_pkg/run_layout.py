from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from .util import ensure_dir, write_json_atomic


@dataclass(frozen=True)
class RunPaths:
    run_dir: Path
    meta_json: Path
    state_json: Path
    stop_request_json: Path
    stdout_log: Path
    stdout_text_log: Path
    stderr_log: Path
    in_log: Path
    inbox_jsonl: Path
    exit_code_txt: Path


def runs_root() -> Path:
    # Policy: cmd_runner is root-only; cwd is required to be the project root.
    return Path.cwd() / "logs" / "cmd_runner"


def run_paths(run_id: str) -> RunPaths:
    d = runs_root() / run_id
    return RunPaths(
        run_dir=d,
        meta_json=d / "meta.json",
        state_json=d / "state.json",
        stop_request_json=d / "stop_request.json",
        stdout_log=d / "stdout.log",
        stdout_text_log=d / "stdout_text.log",
        stderr_log=d / "stderr.log",
        in_log=d / "in.log",
        inbox_jsonl=d / "inbox.jsonl",
        exit_code_txt=d / "exit_code.txt",
    )


def create_run_dir_and_files(run_id: str) -> RunPaths:
    paths = run_paths(run_id)
    if paths.run_dir.exists():
        raise RuntimeError(
            f"Run id already exists: {paths.run_dir}. "
            "Choose a different --run-id (or delete the existing run folder)."
        )
    ensure_dir(paths.run_dir)

    # Create files immediately so 'tail' works even before output exists.
    for p in (paths.stdout_log, paths.stdout_text_log, paths.stderr_log, paths.in_log, paths.inbox_jsonl):
        p.open("wb").close()

    return paths


def write_meta(
    paths: RunPaths,
    *,
    created_utc: str,
    cwd: str,
    argv: List[str],
    env_overrides: Dict[str, str],
    backend: str,
    cols: int,
    rows: int,
    timeout_s: Optional[int],
    max_log_mb: int,
    terminal_host: Optional[str],
) -> None:
    meta = {
        "created_utc": created_utc,
        "cwd": cwd,
        "argv": argv,
        "env_overrides": env_overrides,
        "backend": backend,
        "cols": cols,
        "rows": rows,
        "timeout_s": timeout_s,
        "max_log_mb": max_log_mb,
        "terminal_host": terminal_host,
    }
    write_json_atomic(paths.meta_json, meta)


def write_state(
    paths: RunPaths,
    *,
    status: str,
    pids: List[int],
    exit_code: Optional[int],
    started_utc: Optional[str],
    finished_utc: Optional[str],
    stopped_utc: Optional[str],
    timeout_utc: Optional[str],
    log_limit_bytes: int,
    log_bytes_written: int,
    log_bytes_dropped: int,
    log_truncated: bool,
    backend: str,
    notes: Optional[str] = None,
) -> None:
    state = {
        "status": status,  # running|finished|timeout|stopped
        "pids": pids,
        "exit_code": exit_code,
        "started_utc": started_utc,
        "finished_utc": finished_utc,
        "stopped_utc": stopped_utc,
        "timeout_utc": timeout_utc,
        "backend": backend,
        "log": {
            "limit_bytes": log_limit_bytes,
            "bytes_written": log_bytes_written,
            "bytes_dropped": log_bytes_dropped,
            "truncated": log_truncated,
        },
    }
    if notes is not None:
        state["notes"] = notes
    write_json_atomic(paths.state_json, state)

