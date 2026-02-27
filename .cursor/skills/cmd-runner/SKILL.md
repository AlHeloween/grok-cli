---
name: cmd-runner
description: Run interactive Windows commands safely via cmd_runner (ConPTY-only) with per-run logs and an inbox bridge.
---

# cmd-runner

Use this skill when a command may be:
- long/noisy,
- interactive (prompts, TUIs),
- crash-prone or likely to destabilize the agent when run directly.

## What cmd_runner is (current)

- Windows-only, ConPTY-only, serverless (no background server, no TCP control plane).
- Root-only policy:
  - Repo checkout: must be launched from the repo root (cwd contains `cmd_runner.py` and `cmd_runner_pkg/`).
  - Release bundle: run from the bundle root (cwd contains `cmd_runner.exe`).
- Logs are written to: `logs/cmd_runner/<run_id>/`
- Programmatic input bridge: append JSONL messages to `logs/cmd_runner/<run_id>/inbox.jsonl`.

## How to run it (recommended)

- Repo/dev (any shell; deterministic file entrypoint):
  - `uv run python cmd_runner.py ...`
- Release bundle:
  - `cmd_runner.exe ...` (preferred; no `uv` required)

## Core workflow

1) Start an interactive run (spawns a new window; interactive session is hosted there):
- `uv run python cmd_runner.py start --terminal conhost -- <command ...>`
  - Prints `run_id` and `inbox=` path in the *current* terminal.

2) List / status (from the current terminal):
- `uv run python cmd_runner.py list`
- `uv run python cmd_runner.py status <run_id>`

3) Tail output (from the current terminal):
- Repo checkout: `uv run python cmd_runner.py tail <run_id>` (repo root)
- Release bundle: `cmd_runner.exe tail <run_id>` (bundle root)

4) Inject input programmatically (bridge):
- Append JSONL to: `logs/cmd_runner/<run_id>/inbox.jsonl`
- Built-in (preferred):
  - `uv run python cmd_runner.py send <run_id> --keys "TEXT:/exit,ENTER"`
- Helper (legacy but still available):
  - `uv run python scripts/cmd_runner_inbox_send.py --run-id <run_id> --keys "TEXT:/exit,ENTER"`

5) Stop (serverless terminate):
- `uv run python cmd_runner.py stop <run_id> --reason "done"`
  - Writes `logs/cmd_runner/<run_id>/stop_request.json`; the hosting cmd_runner watches for it and terminates the Job Object.

Notes:
- `add_crlf` defaults to `false` (no implicit Enter). Use `ENTER` in `keys` or `--crlf` in the helper.
- For stable key input/editing, prefer `--terminal conhost`.
