cmd_runner (ConPTY-only, serverless interactive)

Quick start (Windows PowerShell)
  1) cd to the repo root (the folder that contains cmd_runner.py and cmd_runner_pkg/)
  2) uv run cmd_runner.py start -- cmd.exe /c "echo HELLO"
     (opens a new window; interactive session is hosted there)
  3) Alternative (via adm integration; keeps a single progress-log cycle):
     tools/adm.exe --cmd-runner start -- cmd.exe /c "echo HELLO"

Commands
  - start : open a separate terminal window and run an interactive session there
  - tail : print a run log (line-numbered; non-follow by default)
  - list : list runs under logs/cmd_runner/ (includes status summary)
  - status : show a status summary for a run_id (or `--json` for raw state.json)
  - send : append input to inbox.jsonl for a run_id (bridge)
  - stop : request the hosting process to terminate the run (writes stop_request.json)

Logs
  - Single canonical run folder: logs/cmd_runner/<run_id>/
  - meta.json (immutable), state.json (live), stdout.log (raw PTY output), in.log (all injected input events)
  - stdout_text.log (human-readable): stdout.log with ANSI/VT sequences stripped
  - inbox.jsonl (bridge inbox): append JSON lines here to inject input programmatically during the run
  - stop_request.json: created by `stop` (hosting process watches it and terminates the job)

Notes
  - Output is streamed live to the console and also persisted to stdout.log.
  - Input is read via ReadConsoleInputW (KEY_EVENT) when stdin is a real console; if stdin is a pipe (common in Windows Terminal), raw VT bytes are read and forwarded.
  - Resize is best-effort (uses ResizePseudoConsole when available).
  - `start` spawns the hosting window minimized by default. If you want the most reliable input/editing, omit `--terminal` (defaults to `conhost`).
  - Supported terminal hosts are `conhost` and `wt`.
  - On exit, cmd_runner writes a small terminal reset sequence (show cursor, reset attributes, exit alt-screen) and flushes console input buffer best-effort.
  - At runtime, cmd_runner prints the chosen input strategy to stderr (ReadConsoleInputW vs stdin pipe vs msvcrt fallback).
  - Management output is hardware-grounded where possible:
    - `list`/`status` re-check a run marked `running` against OS PIDs and may report `lost` if the host process is gone.
    - If PID probing is not possible, status may be reported as `running?` (unknown).
  - When the hosting console window is closed, cmd_runner attempts to stop the child process tree and persist `state.json` (best-effort).

Inbox bridge format (JSONL)
  - One JSON object per line:
    - {"text": "dir", "add_crlf": false}
    - {"data_b64": "BASE64...", "add_crlf": false}
    - {"keys": ["TEXT:/ext","LEFT","CHAR:i","ENTER"], "add_crlf": false}
  - Policy: `add_crlf` defaults to `false` (no implicit Enter). Use `ENTER` in `keys` or set `add_crlf:true` explicitly.

Helper
  - Append a line to a run inbox:
    - uv run scripts/cmd_runner_inbox_send.py --run-id <run_id> --text "dir"
  - Send high-level keys (respects application-cursor mode if the child enables it):
    - uv run scripts/cmd_runner_inbox_send.py --run-id <run_id> --keys "TEXT:/exit,ENTER"
  - Send raw bytes:
    - uv run scripts/cmd_runner_inbox_send.py --run-id <run_id> --hex 0D0A

Separate window
  - Launch a new window (interactive there) and print run_id + inbox path in the current terminal:
    - uv run cmd_runner.py start -- cmd.exe

Management (serverless)
  - List runs:
    - uv run cmd_runner.py list
  - Tail output (defaults: `--text` + non-follow). Stream live output until finished:
    - uv run cmd_runner.py tail <run_id> --follow
  - Show status:
    - uv run cmd_runner.py status <run_id>
  - Send keys/text:
    - uv run cmd_runner.py send <run_id> --keys "TEXT:/exit,ENTER"
  - Stop (force terminate via Job Object):
    - uv run cmd_runner.py stop <run_id> --reason "done"

Manual interactive smoke checklist (recommended: conhost)
  1) Launch a new interactive window running a simple line editor probe:
     - uv run cmd_runner.py start --terminal conhost -- uv run scripts/line_edit_probe.py --lines 1
  2) In the original terminal, inject keystrokes via the inbox bridge:
     - uv run scripts/cmd_runner_inbox_send.py --run-id <run_id> --keys "TEXT:abc,LEFT,CHAR:X,ENTER"
  3) Expected output in the spawned window:
     - READY
     - line0> aXbc
     - LINE0='aXbc'

Suggested key/edit cases (inject via --keys)
  - Backspace: TEXT:abc,LEFT,BACKSPACE,ENTER          (expect: 'ac')
  - Delete:    TEXT:abc,LEFT,DELETE,ENTER             (expect: 'ab')
  - Home/End:  TEXT:abc,HOME,CHAR:X,END,CHAR:Y,ENTER  (expect: 'XabcY')

Automated tests (safe defaults)
  - Unit tests: uv run pytest -q
  - Opt-in runtime smoke tests (Windows only): set CMD_RUNNER_SMOKE=1, then:
    - uv run pytest -q tests_runtime
