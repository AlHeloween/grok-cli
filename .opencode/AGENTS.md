---
title: "Agent Operational Rules"
owner: "agents@grok-cli.local"
status: "production"
surface: "agents_md"
last_verified: "2026-03-02"
tags: ["agent", "documentation", "rules"]
related_code:
  - "AGENTS.md"
  - "docs/ADID_Framework_15_3.md"
summary: "Operational rules for agents using ADID framework and adm tool."

reproduce:
  files:
    - "AGENTS.md"
    - "docs/ADID_Framework_15_3.md"
  commands:
    - "grep -q \"Quick-Start\" AGENTS.md"
  inputs:
    - "AGENTS.md@sha256:5e1cb26eac3a8ed17c126104563400eead7d96323aa666de70944d9f878ea3d7"
  expected_outputs:
    - "AGENTS.md contains 'Quick-Start' header"
---# Quick-Start

**Search Policy Rule:** Before running any search commands, use global search within the project directory first. Ensure the final path used is within the project range. Never access files outside the project directory unless explicitly required and verified.

**Contents:** [Before any activity](#before-any-activity) · [Skills](#skills) · [Response & traceability](#response--traceability) · [Project structure](#project-structure) · [Search policy](#search-policy) · [Declarative workflow (adm)](#declarative-workflow-adm) · [Verification](#verification) · [Agent Safety](#agent-safety-critical) · [Recovery](#recovery-playbook-when-things-go-sideways) · [Execution (Bun)](#execution-bun) · [Code quality](#-code-quality--standards) · [References](#-references) · [Why ADID and adm for this project](#why-adid-and-adm-for-this-project)

---

## Response & traceability

Follow the **entire** [docs/ADID_Framework_15_3.md](docs/ADID_Framework_15_3.md): communication rules (I), information marks (Exact/Inferred/Hypothetical/Guess/Unknown), State Record (SV, md5_sv_tag, semantic_link), traceability and reverse search, and AGI Reasoning Kernel (section 15). **Rule 18:** deeply read and understand the **entire** framework.

- **For coding output:** Provide executable code or scripts appropriate to the stack (here: TypeScript/Bun). Keep files manageable; prefer explicit error handling in tests.
- **ADID + adm** gives structured, auditable edits and **reduces reliance on the paid Morph Fast Apply service**.

---

## Before any activity

1. **READ (required):** The **entire** `docs/ADID_Framework_15_3.md` (rule 18)—communication rules, AGI kernel, ADID workflow and adm, development guidelines. Then read `docs/APPLICATION-SCHEME.md` and `docs/AGENT.md` for grok-cli layout and agent behavior. Optionally: `docs/settings.json.md`, `docs/HANDOVER.md`.
2. **Use adm for changes.** **Adm is located at tools/** — use `tools/adm` (or `tools/adm.exe` on Windows) for declarative updates (template → edit descriptor in `updates/` → apply). Do not write XML descriptors from scratch. Run `tools/adm --help` when unsure. **Never restore from git** over local work; use `tools/adm --rollback <file>` and descriptor rollbacks. Using adm for file edits reduces the need for the paid Morph Fast Apply service.
3. **Workflow:** Template → edit descriptor in `updates/` → apply. Backups are automatic.
4. **App build and test:** Run `bun install` and `bun run build` at session start when touching code; run `bun run typecheck`, `bun run lint`, and `bun run test` before submitting changes.

---

## Skills

Use the `skill` tool to load specialized instructions for particular tasks. Available skills:

- **adm‑exe**: Declarative file updates, verification, rollback, and template workflows with ADID Update Manager (adm). Load this skill when performing adm operations.
- **agent‑assets**: Maintain canonical artefacts and install agent receiver scaffolds (.cursor/.codex/.opencode). Load this skill when editing rules or skills.
- **cmd‑runner**: Run interactive Windows commands safely via cmd_runner (ConPTY‑only) with per‑run logs and an inbox bridge. Use for long/noisy, interactive, or crash‑prone commands that may destabilize the agent.
- **dunit**: Run and maintain Delphi DUnit tests for the ADID installer and related Delphi units.
- **delphi_builder**: Build Delphi (VCL/FMX) projects from the command line with MSBuild, including environment initialization (MSVC + rsvars).

**When to use:** If a task matches a skill description, load the skill first to get detailed workflows and commands. Use `skill` tool with the skill name (e.g., `skill("cmd‑runner")`).

## Project structure

- `package.json` — Dependencies and scripts; use `bun install` at session start.
- `README.md` — User-facing install, usage, RAG, MCP, config.
- `AGENTS.md` — Operational rules for agents (this file).
- `docs/APPLICATION-SCHEME.md` — Module map and file roles.
- `docs/AGENT.md` — Agent flow, tools, RAG, config, MCP.
- `docs/settings.json.md` — All settings and env.
- `docs/ADID_Framework_15_3.md` — ADID Framework (required reading for agents; see rule 18).
- `src/index.ts` — CLI entry (Commander, subcommands, interactive UI).
- `src/ui/` — Ink components (chat-interface, theme, config menu, etc.).
- `src/agent/` — GrokAgent, tool-executor, system-prompt.
- `src/grok/` — API client and tool schemas.
- `src/rag/` — Indexer, retriever, vector-db, embedding-client, k-medoids.
- `src/tools/` — Text-editor, bash, search, todo, confirmation, optional Morph.
- `src/config/` — Registry, effective-config.
- `src/mcp/` — Config, client, transports.

Source: [docs/APPLICATION-SCHEME.md](docs/APPLICATION-SCHEME.md) sections 2.1–2.7+.

---

## Search policy

- **In-file content search:** `rg -n -- "pattern" path/`.
- **File name/path search:** `fd name path/` (add `-H` for hidden; add `-uu` to include ignored/untracked when needed).
- **Search through .gitignore:** Use `rg -nuc -- "pattern"` to search ignoring .gitignore patterns when needed.
- **Filtering command output:** `grep` is allowed for pipes (e.g. `winget list | grep Node`).

Use `tools/adm` (or `tools/adm.exe` on Windows) when making declarative changes or refactors (e.g. Semgrep strategy via adm).

- Generate template: `tools/adm --template all` (alias: `--tpl`).
- Preview demos without touching disk: `tools/adm --demo --dry-run`. Set `ADID_ENABLE_DEMOS=1` to enable `--demos`/`--demo`.
- Synchronize Semgrep ignores with VCS: `tools/adm --sync-semgrepignore`.

### Declarative workflow (adm)

**Adm is located at tools/.** Use `tools/adm` (or `tools/adm.exe` on Windows).

**Canonical workflow:** (1) Template: `tools/adm --template all` (or `uv run adm --template all` when tools/adm not present). (2) Edit the generated descriptor in `updates/` with the changes you want. (3) Apply: `tools/adm --apply updates/<that_file>.xml`. Do not write XML descriptors from scratch.

- **Replay history:** `tools/adm --replay-updates [dir] [--until TIMESTAMP] [--limit N]` applies descriptors in chronological order; use `--dry-run` to list only.
- **Multiple backups per file** are by design (rollback, traceability).

### Verification

- `--verify-all` respects `.gitignore` at the chosen root. Keep `.gitignore` accurate.
- **Root policy:** Use roots that exist in this repo, e.g. `tools/adm --verify-all src tests` (or `uv run adm --verify-all src tests` when tools/adm not present). Omit `adid_tests` if not present.
- Reports: `logs/verify_report_<timestamp>.{json,md}`. Semgrep diagnostics: `logs/<timestamp>_semgrep_test_timings.log`.

### Traceability artifacts

Optionally maintain a handover or progress note; see [docs/HANDOVER.md](docs/HANDOVER.md). Use the `[TIMESTAMP]_[short_semantic_dominant]` naming scheme for descriptors (see [Declarative workflow (adm)](#declarative-workflow-adm)).

### Semgrep strategy (refactors)

- Use Semgrep as the structure-aware engine where adm supports it. Respect `.semgrepignore`—mirror `.gitignore` with `tools/adm --sync-semgrepignore` (or `uv run adm --sync-semgrepignore` when tools/adm not present).

### Core Tool Capabilities

The adm CLI provides (see [Declarative workflow (adm)](#declarative-workflow-adm)). Use `tools/adm` (or `tools/adm.exe` on Windows) when the project has it—otherwise `uv run adm`.

- **Template:** `tools/adm --template all` — timestamped update templates (or per-mode: `replace`, `overwrite`, `create`, `insert`, `delete`, `pattern-rule`).
- **Apply:** `tools/adm --apply updates/<file>.xml` — apply descriptor (atomic writes, backups, ledger).
- **Replay history:** `tools/adm --replay-updates [dir] [--until TIMESTAMP] [--limit N]` — `--dry-run` to list only.
- **Verify:** `tools/adm --verify-all [root]` — JSON/Markdown reports; use `src` and `tests` for a clean report (see [Verification](#verification)). Add `--verify-all-fix-xml` to rewrite descriptor tags in place.
- **Traceability logging:** `--log-progress [path]` — append execution details to `_progress_log.md` (default).
- **Demo & Replay bundles:** `tools/adm --demo <name>` — workflow examples with replayable scripts.

**Fake data for tests must be created by tests** — in multi-agent development, fake data created elsewhere can cause confusion or leak into application logic.

---

## Execution (Bun)

Use **Bun** for building and testing the grok-cli app:

- **Build:** `bun run build`
- **Typecheck:** `bun run typecheck`
- **Lint:** `bun run lint`
- **Tests:** `bun run test` (Vitest); watch: `bun run test:watch`; coverage: `bun run test:coverage`
- **Run app:** `grok` (after `bun link`) or `bun run dev`
- **Interactive/long‑running commands:** For commands that are interactive, long/noisy, or crash‑prone, consider using `cmd_runner` (Windows ConPTY). Load the `cmd‑runner` skill for details.

Require **build**, **typecheck**, **lint**, and **test** to pass before submitting changes (see [CONTRIBUTING.md](CONTRIBUTING.md)).

Use `uv run adm` only as fallback when `tools/adm` is not present (e.g. before adm is installed in the project).

---

## Agent Safety (Critical)

- **Never restore from git** over local work. Use backups and rollbacks: `tools/adm --list-backups <file>`, `tools/adm --rollback <file>` (or `uv run adm ...` when tools/adm not present). Verify after rollback: `tools/adm --verify-all src tests` (see [Verification](#verification)).
- Treat adm core as immutable when present; make changes via XML descriptors and CLI; extend by copying the tool.
- Always pass `--log-progress _progress_log.md` (or chosen path) to record actions and outcomes when using adm.
- **Shortcut / test-skip policy:** If you want to skip the standard operation flow, skip tests, or take shortcuts, you must: (1) Re-read the newest `docs/ADID_Framework_*.md` fully. (2) Perform reverse search over the entire dialog message history. (3) Perform fractal task decomposition followed by k-medoids clustering and propose at least **5** solution options, then wait for the user decision before executing.
- Prefer Semgrep-first refactors via adm where applicable; use `--rg`/`--sed` via adm to retain backups and ledgers. Mirror ignores: `tools/adm --sync-semgrepignore` (see [Semgrep strategy](#semgrep-strategy-refactors)).

---

## Recovery Playbook (When Things Go Sideways)

- **Triage:** Inspect latest `logs/verify_report_*.md`/`.json`. If using Semgrep, check `logs/*_semgrep_test_timings.log`.
- **Locate a stable point:** List backups: `tools/adm --list-backups <file>`. Pick the timestamp closest to the last known good run.
- **Roll back and verify:** Roll back: `tools/adm --rollback <file>`. Verify: `tools/adm --verify-all src tests` (or `.` for full tree). Run app tests: `bun run build` and `bun run test` to confirm app health.
- **Restore intent declaratively:** See [Declarative workflow (adm)](#declarative-workflow-adm): template → edit descriptor → apply. Optionally replay: `tools/adm --replay-updates --dry-run` to see descriptor order, then apply selectively or `tools/adm --replay-updates`.

---

## Code Quality & Standards

### Style (TypeScript/ESLint)

- **ESLint:** Run `bun run lint`; fix reported issues. Follow existing TypeScript patterns; avoid `any` unless necessary and documented.
- **Theming:** Add or update themes in `src/ui/utils/theme.ts` using semantic tokens (see [CONTRIBUTING.md](CONTRIBUTING.md)).

### Logic & transparency

- **Modular:** Keep UI and logic separated.
- **Precision:** Deliver code that is provably correct; typecheck, lint, and test before output.
- **Provenance:** Reference official docs, examples, or codebase inspection. Do not guess API usage.
- **Clarity on uncertainty:** Mark assumptions or unverified code: ASSUMPTION / UNVERIFIED / TODO (VERIFY).

### Security & configuration

- **No hardcoded secrets.** Use environment variables or an ignored config file.
- **Logging:** Never log sensitive data (tokens, passwords, etc.).
- **Bash tool:** Commands run with user privileges; always review suggested commands before accepting (see [CONTRIBUTING.md](CONTRIBUTING.md) security).
- **cmd_runner:** For interactive, long‑running, or crash‑prone commands, use `cmd_runner` (Windows ConPTY) to isolate the agent from instability and capture logs in `logs/cmd_runner/`.

---

## References

- **Required for agents:** [docs/ADID_Framework_15_3.md](docs/ADID_Framework_15_3.md) — read **entire** doc per rule 18; enables adm-based edits and reduces need for Morph Fast Apply.
- [README.md](README.md) — Install, usage, RAG, MCP, config.
- [docs/APPLICATION-SCHEME.md](docs/APPLICATION-SCHEME.md) — Module map and file roles.
- [docs/AGENT.md](docs/AGENT.md) — Agent flow, tools, RAG, config, MCP.
- [docs/settings.json.md](docs/settings.json.md) — All settings and env.
- [docs/HANDOVER.md](docs/HANDOVER.md) — Quick handover for developers.
- [CONTRIBUTING.md](CONTRIBUTING.md) — Build, test, lint, style.
- Adm: `tools/adm --help`; `adm.md` (repo root) and `src/adm/README.md` if present.
- **Skills:** Load specialized instructions via `skill` tool: adm‑exe, agent‑assets, cmd‑runner, dunit, delphi_builder.
- [Vitest](https://vitest.dev/), [ESLint](https://eslint.org/), [TypeScript](https://www.typescriptlang.org/docs/), [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

---

## Why ADID and adm for this project

- **Adm is located at tools/.** Use `tools/adm` (or `tools/adm.exe` on Windows) for declarative updates, verify-all, and rollback.
- **ADID + adm replaces much of the need for the paid Morph Fast Apply service:** the agent gets precise, traceable file updates via template → edit descriptor → apply, with backups and rollback, without depending on Morph. For app build and tests use Bun/Vitest.

<!-- ADID_ROLLBACK (from adm.exe)
  SDID_ROLLBACK {
    "target_file": "D:\\zPython\\grok-cli\\.opencode/AGENTS.md"
    "update_script": "adm.exe"
    "backup_path": "D:\\zPython\\grok-cli\\.opencode/AGENTS.md.backup_20260302T224412_442596"
    "created_at": "2026-03-02T14:44:12.457061+00:00"
    "backup_hash": "a82a94ac488ada3cc23ad6742e0bf619"
    "new_hash": "ae3ee8a6665edf4876993ace1c6aff22"
    "goal_id": "opencode_agents_md_hash_update"
    "semantics": "Replace placeholder SHA256 hash with actual hash in .opencode copy"
    "update_attrs": {"relative_path": ".opencode/AGENTS.md", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "- \"AGENTS.md@sha256:TO_BE_FILLED\"", "replace_present": true}
    "restore_cmd": "uv run adm \u002d\u002drollback \"D:\\zPython\\grok-cli\\.opencode/AGENTS.md\""
  }
-->
