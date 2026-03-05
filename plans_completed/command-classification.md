# CLI Command Classification Plan

## Overview

This document outlines the hierarchical structure of grok-cli commands to ensure logical organization, avoid naming conflicts, and support future extensibility.

## Current Command Structure (as of 2026-03-06)

### Top-level Commands

1. **`grok`** (default interactive mode)
   - Positional argument: `[message...]` (initial message for interactive chat)
   - Options:
     - `-d, --directory <dir>` – set working directory
     - `-k, --api-key <key>` – Grok API key
     - `-u, --base-url <url>` – Grok API base URL
     - `-m, --model <model>` – AI model selection
     - `--theme <theme>` – UI theme ID
     - `-p, --prompt <prompt>` – headless mode (process single prompt)
     - `--max-tool-rounds <rounds>` – maximum tool execution rounds
     - `--list-models` – list configured models and exit
     - `--load-chat-session <sessionId>` – load saved chat session

2. **`grok git`** – Git operations with AI assistance
   - Subcommand:
     - `commit-and-push` – generate AI commit message and push to remote

3. **`grok mcp`** – Manage MCP (Model Context Protocol) servers
   - Subcommands:
     - `add <name>` – add an MCP server
     - `add-json <name> <json>` – add from JSON configuration
     - `remove <name>` – remove an MCP server
     - `list` – list configured MCP servers
     - `test <name>` – test connection to an MCP server

4. **`grok rag`** – Local RAG (retrieval) indexing and status
   - Subcommands:
     - `index` – index current project into `.grok/rag.db`
     - `status` – show RAG status for the current project
     - `export-makerai` – export `.grok/rag.db` into MakerAI RAGVector JSON format
     - `import-makerai <file>` – import MakerAI JSON file into `.grok/rag.db`
     - `gui` – open MakerAI‑based GUI to browse/edit RAG

5. **`grok glove`** – Manage GloVe word embedding databases
   - Subcommands:
     - `status` – show current GloVe database status
     - `path` – print resolved GloVe database path
     - `generate` – generate SQLite database from GloVe text file
     - `download` – download GloVe embeddings from URL (not yet implemented)
     - `list-dimensions` – list available GloVe dimensions

6. **`grok config`** – Configure Grok CLI (list/get/set/init)
   - Subcommands:
     - `list` – list effective configuration (and its source)
     - `get <key>` – get a config value
     - `set <key> <value>` – set a config value (writes to settings files)
     - `init` – initialize template config files if missing

7. **`grok chat-history`** – Manage persistent chat history sessions
   - Subcommands:
     - `list` – list all saved chat sessions
     - `load <sessionId>` – load a chat session by ID
     - `delete <sessionId>` – delete a chat session

## Classification Principles

### 1. Command Groups
- **Core**: `git`, `config`, `chat-history` – essential CLI operations.
- **RAG & Embeddings**: `rag`, `glove` – retrieval‑augmented generation and local embedding providers.
- **Integrations**: `mcp` – external protocol integrations.
- **Interactive**: default `grok` command (chat interface).

### 2. Subgroup Naming
- Use **singular nouns** for group names (`rag`, `glove`, `config`).
- Use **action‑oriented verbs** for subcommands (`index`, `status`, `list`, `add`, `remove`).
- Avoid generic subcommand names that could conflict across groups (e.g., `list` is fine because it’s scoped to its parent group).

### 3. Conflict Avoidance
- No two subcommands under the same parent may have the same name.
- Subcommand names should not shadow top‑level command names (e.g., `grok rag` cannot have a subcommand `rag`).
- Use distinct names for conceptually different operations (e.g., `export‑makerai` vs `import‑makerai`).

### 4. Extensibility
- New groups should be added as top‑level commands under `grok`.
- If a new group has many subcommands, consider further nesting (e.g., `grok rag embeddings`).
- Use kebab‑case for multi‑word subcommand names (`export‑makerai`, `list‑dimensions`).

## Proposed Future Extensions

### Embeddings Management
- `grok embeddings` – unified embedding provider management
  - `list` – list available embedding providers
  - `test` – test embedding provider connectivity
  - `download` – download pre‑trained models

### Quantization Control
- `grok rag quantize` – manage vector quantization
  - `enable` – enable quantization for current project
  - `disable` – disable quantization
  - `status` – show quantization settings

### Advanced RAG Operations
- `grok rag query` – direct retrieval queries (debugging)
- `grok rag stats` – detailed statistics about the index

### Testing & Validation
- `grok test` – run test suites
  - `rag` – RAG‑specific tests
  - `embeddings` – embedding provider tests
  - `integration` – end‑to‑end integration tests

## Implementation Guidelines

### Adding a New Command Group
1. Create a new file in `src/commands/<group>.ts` exporting a `create<Group>Command()` function.
2. Import and add the command in `src/index.ts` using `program.addCommand(create<Group>Command())`.
3. Follow the existing patterns for option definitions, action handlers, and error handling.

### Adding a Subcommand
1. Locate the appropriate command group in `src/index.ts` or the dedicated command file.
2. Chain `.command("<subcommand>")` with description, options, and action.
3. Ensure the subcommand name does not conflict with existing subcommands in the same group.

### Documentation
- Update `README.md` with new command syntax and examples.
- Add help text within the command description.
- Consider adding a `--help` flag to each subcommand (automatically provided by Commander).

## Current Conflicts & Resolutions

### Known Conflict: `index` subcommand
- **Issue**: Previously a conflict between `grok chat-history index` and `grok rag index`.
- **Resolution**: Removed `chat-history index` subcommand (no longer needed). Only `grok rag index` remains.

### Verification
Run `grok --help` and verify no duplicate command names appear. All subcommands should be listed under their respective groups.

## Maintenance

- Periodically review command structure using `grok --help`.
- Use the `adm` tool for declarative updates when modifying command definitions.
- Keep this document updated as the CLI evolves.

---

*Last updated: 2026‑03‑06*