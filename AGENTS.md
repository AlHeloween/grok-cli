# Quick-Start

**Contents:** [Before any activity](#before-any-activity) · [Response & traceability](#response--traceability) · [Project structure](#project-structure) · [Search policy](#search-policy) · [Declarative workflow (adm)](#declarative-workflow-adm) · [Verification](#verification) · [Agent Safety](#agent-safety-critical) · [Recovery](#recovery-playbook-when-things-go-sideways) · [Execution (Bun)](#execution-bun) · [Code quality](#-code-quality--standards) · [References](#-references) · [Why ADID and adm for this project](#why-adid-and-adm-for-this-project)

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
- [Vitest](https://vitest.dev/), [ESLint](https://eslint.org/), [TypeScript](https://www.typescriptlang.org/docs/), [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

---

## Why ADID and adm for this project

- **Adm is located at tools/.** Use `tools/adm` (or `tools/adm.exe` on Windows) for declarative updates, verify-all, and rollback.
- **ADID + adm replaces much of the need for the paid Morph Fast Apply service:** the agent gets precise, traceable file updates via template → edit descriptor → apply, with backups and rollback, without depending on Morph. For app build and tests use Bun/Vitest.
