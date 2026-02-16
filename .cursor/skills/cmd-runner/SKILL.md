---
name: cmd-runner
description: Runs long or crash-prone commands safely on Windows by delegating to cmd-runner (executable in PATH or repo cmd_runner.py). Background runs with run_id, status polling, tail, follow, stop, timeout, and stdin send. Use when executing shell commands, debugging CLI tools, or when large exit codes / noisy stderr may crash the agent.
---

# cmd-runner

## When to use

- Run long, noisy, or crash-prone commands without destabilizing the console.
- Keep an auditable history of commands and results (run_id + logs).
- Poll status across terminals (start -> status/wait -> tail/follow -> stop).

## Preferred invocation

- Repo-local (system python): `python .\cmd_runner.py ...` (use when checking interpreter features like datetime.UTC on 3.9).
- Repo-local (uv env): `uv run python .\cmd_runner.py ...` (project-managed environment).
- Optional global: `cmd-runner ...` if `cmd-runner.exe` is on PATH and passes the smoke check.

## Workflow (repo cmd_runner.py)

1. `uv run python .\cmd_runner.py --help`
2. Start: `uv run python .\cmd_runner.py start --cwd <repo_root> [--timeout-s N] [--shell cmd|powershell|direct] -- <COMMAND>` (prints `run_id`)
3. Status: `uv run python .\cmd_runner.py status <run_id> [--tail 80] [--raw-tail]`
4. Wait: `uv run python .\cmd_runner.py wait <run_id> [--timeout-s N]`
5. Stop one: `uv run python .\cmd_runner.py stop <run_id> [--force]`
6. Kill all: `uv run python .\cmd_runner.py killall [--force]`
7. Logs: `logs/cmd_runner/runs/<run_id>/{stdout.log,stderr.log,state.json,meta.json}`

Notes:
- Logs live under `<run_root>/logs/cmd_runner/runs/<run_id>/...`; run_root defaults to the cmd_runner script/exe location (or nearest pyproject) and can be overridden with `CMD_RUNNER_ROOT`.
- `list` prints `state`, `running` (pid-checked), and `timeout_s` for each run_id.
- Default behavior is no popup windows on Windows; pass `--show-window` only when you explicitly want a visible console.

## Log-based traceability (training data)

Each run is stored under `logs/cmd_runner/runs/<run_id>/` and includes:
- `meta.json`: command line, cwd, shell, timeout_s, env overrides, and start timestamp.
- `state.json`: live state (starting/running/finished/stopped), PID, exit code, timestamps.
- `stdout.log` / `stderr.log`: raw outputs (not obfuscated).
- `stdin.queue`: queued stdin lines when `--stdin` is enabled.

Use these logs as a command/result ledger for regression, replay, and skill training:
- Map `meta.json` (command + params) to `stdout.log`/`stderr.log` outcomes.
- Prefer log files for troubleshooting; console output is obfuscated by default.

## Smoke check (global exe)

```powershell
cmd-runner --help
$run_id = (cmd-runner start --shell cmd --timeout-s 30 -- cmd /c echo CMD_RUNNER_SMOKE | Select-Object -First 1).Trim()
cmd-runner status $run_id --tail 20
cmd-runner list --limit 5
```

If `status` prints `unknown` or `list` is empty, use repo-local `cmd_runner.py` via `uv run python`.

<!-- ADID_ROLLBACK (from adm.exe)
  SDID_ROLLBACK {
    "target_file": "D:\\zPython\\ADID_Python\\cursor_artifacts/skills/cmd-runner/SKILL.md"
    "update_script": "adm.exe"
    "backup_path": "none"
    "created_at": "2026-02-08T08:22:39.294608+00:00"
    "new_hash": "b44f502c9668fa7cd282f9d2ad48d33e"
    "goal_id": "cmd_runner_skill_create"
    "semantics": "Add cmd-runner skill documentation with log-based traceability notes."
    "update_attrs": {"relative_path": "cursor_artifacts/skills/cmd-runner/SKILL.md", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
    "restore_cmd": "uv run adm \u002d\u002drollback \"D:\\zPython\\ADID_Python\\cursor_artifacts/skills/cmd-runner/SKILL.md\""
  }
-->
