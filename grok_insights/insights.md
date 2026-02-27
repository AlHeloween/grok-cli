# Grok CLI Project Insights (@vibe-kit/grok-cli v0.0.34)

**Date Generated:** Current session insights from codebase scan.

## Overview
Open-source terminal AI agent integrating Grok (xAI) for coding, file editing, system ops, and agentic workflows. Hybrid **TypeScript/Node.js** (main CLI/entrypoint) + **Python** (command execution backend). ESM module, built with Bun/Vitest/ESLint/TS. Terminal UI via marked-terminal.

## Repo Status (main branch, up-to-date with origin/main)
- **Modified (uncommitted)**: AGENTS.md, cmd_runner_pkg/README.md/cli.py, tools/cmd_runner.exe
- **Untracked**: _build.cmd, test.out
- Heavy AI dev artifacts: `.adid.log.jsonl`, `.baseline`, multiple backups (Cursor/Codex/Jules/OpenCode assisted).

## Core Structure
```
.
├── src/                  # TS core
│   ├── agent/            # Grok agent logic (grok-agent.ts)
│   ├── commands/         # CLI commands
│   ├── config/           # Config handling
│   ├── grok/             # Grok client (client.ts)
│   ├── hooks/            # Lifecycle hooks
│   ├── index.ts          # Entry (37k lines, complex)
│   ├── mcp/              # ? Multi-Command Protocol
│   ├── rag/              # Retrieval-Augmented Generation
│   ├── tools/            # Tool integrations (file ops, bash, search)
│   ├── types/            # TS types
│   ├── ui/               # Terminal UI
│   └── utils/            # Helpers
├── cmd_runner_pkg/       # Python backend (~1k lines cli.py)
│   └── cli.py            # Subprocess/threaded cmd executor (base64/JSON handling)
├── docs/                 # ADID framework, agent guides
├── AGENTS.md             # Agent playbook (skills, safety, ADID/ADM workflows, verification)
├── package.json          # Exports dist/index.{js,d.ts}
├── bun.lock/package.json # Bun-based deps/build
├── tools/scripts/        # Build helpers, cmd_runner.exe (built Python?)
└── tests/ node_modules/  # Vitest coverage
```

- **Key files**: Grok refs in `src/agent/grok-agent.ts`, `src/grok/client.ts`.
- **Tech stack**: TS/ES modules, Bun, Vitest, Ripgrep (rg available), sed. Windows (PowerShell; use `dir`, `rg`).

## Strengths
- Agentic design: Tools-first (file edit/create/search/bash/todo), real-time web/X search.
- Meta-docs: AGENTS.md enforces structured AI responses (traceability, safety, declarative workflows).
- Cross-platform tools (rg/sed confirmed).
- RAG/MCP for advanced reasoning.

## Potential Issues/Gaps
- Uncommitted changes: Review/merge AGENTS.md/cli.py diffs.
- Mixed langs: TS-Py interop via subprocess? Scalability?
- Bloat: index.ts (37k lines), many backups → Refactor?
- No pyproject.toml/py deps visible → Pure stdlib Python?
- Windows quirks: Bash tool fails on cmd/PowerShell; stick to `dir`, `rg`, `pwsh`.

## Recommendations
1. `git add/commit` changes.
2. Build/test: `bun install`, `bun test`.
3. Deep dive: View `src/index.ts` or search \"agent\" for workflows.
4. Clean: Remove backups/artifacts (e.g., `rg --files-with-matches '\\.adid\\.log\\.jsonl\\$' | xargs rm`).

**Next steps:** Reference this for tasks like refactoring or feature adds.