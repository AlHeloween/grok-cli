# Project Documentation Index (DOCIndex.md)

## Overview

This document provides a step‑by‑step record of the grok‑cli project's file structure and purpose. It is updated as the project evolves.

## Directory Structure

### Root
- `package.json` – Dependencies and Bun scripts (build, test, lint, typecheck).
- `README.md` – User‑facing installation, usage, RAG, MCP, configuration.
- `AGENTS.md` – Operational rules for agents (ADID framework, adm workflow, skills).
- `CONTRIBUTING.md` – Build, test, lint, style guidelines.
- `CHANGELOG.md` – Release history.
- `tsconfig.json` – TypeScript configuration.
- `vitest.config.ts` – Test runner configuration.
- `bun.lock` – Bun lockfile.
- `.gitignore`, `.eslintrc.js`, `.env.example` – standard tooling files.

### `src/` – Source Code

#### `src/index.ts`
Main CLI entry point (Commander.js). Defines:
- Interactive chat mode (`grok`).
- Headless mode (`grok -p`).
- Subcommands: `git commit-and-push`, `rag`, `config`, `chat-history`, `mcp`, `glove`.

#### `src/agent/` – Grok Agent Core
- `grok-agent.ts` – Main agent class (processes user messages, manages tool execution, RAG context injection).
- `system-prompt.ts` – Base system prompt with tool descriptions, RAG instructions.
- `chat-history-manager.ts` – In‑memory chat history management.
- `chat-history-persistence.ts` – Persistent chat session storage (`.grok/chat-history/`).
- `tool‑executor.ts` – Executes individual tools (bash, search, text editor, etc.).

#### `src/ui/` – Ink‑based Terminal UI
- `components/chat-interface.tsx` – Main interactive chat UI.
- `components/chat-history.tsx` – Chat history sidebar.
- `components/config-menu.tsx` – Configuration menu (`/config`).
- `context/theme-context.tsx` – Theme provider (dark/light).
- `utils/theme.ts` – Theme definitions (VSCode dark/light, Solarized, etc.).

#### `src/grok/` – Grok API Client
- `client.ts` – HTTP client for Grok API (chat completions, tool calls).
- `tools.ts` – Tool schema definitions and MCP manager.

#### `src/rag/` – Retrieval‑Augmented Generation
- `indexer.ts` – Indexes project files into vector database (`.grok/rag.db`).
- `retriever.ts` – Retrieves top‑K chunks for a query.
- `vector‑db.ts` – SQLite vector database operations (chunk storage, similarity search).
- `embedding‑client.ts` – Creates embedding vectors (supports OpenAI, GloVe, hash providers).
- `embedding‑provider‑base.ts` – Base interface for embedding providers.
- `embedding‑factory.ts` – Factory that creates provider instances from settings.
- `embedding‑providers/` – Provider implementations:
  - `openai‑provider.ts` – OpenAI‑compatible API provider.
  - `glove‑provider.ts` – GloVe averaging provider (SQLite word vectors).
  - `hash‑provider.ts` – Deterministic hash‑based embeddings.
- `chat‑indexer.ts` – Indexes chat history for retrieval.
- `makerai.ts` – Import/export to MakerAI RAGVector JSON format.
- `k‑medoids.ts` – K‑medoids clustering for candidate selection.

#### `src/config/` – Configuration Management
- `registry.ts` – Configuration key definitions (user, project, environment).
- `effective‑config.ts` – Computes effective configuration with precedence (CLI > env > project > user > defaults).
- `settings‑manager.ts` – Loads/saves user and project settings (`.grok/user‑settings.json`, `.grok/settings.json`).

#### `src/commands/` – CLI Command Modules
- `mcp.ts` – `grok mcp` command (add, remove, list MCP servers).
- `glove.ts` – `grok glove` command (status, path, generate, download GloVe databases).

#### `src/utils/` – Utilities
- `settings‑manager.ts` (see config) – unified settings access.
- `path‑utils.ts` – Resolves project‑relative paths (GloVe DB, RAG DB).
- `model‑config.ts` – Loads model definitions (`models.json`).
- `confirmation‑service.ts` – Headless mode auto‑approval of operations.

#### `src/hooks/` – React Hooks (UI)
- `use‑input‑handler.ts` – Handles keyboard shortcuts, slash commands.
- `rag‑menu‑handler.ts` – RAG menu actions (index, status, GUI).
- `use‑rag‑menu.ts` – RAG menu state.

#### `src/tools/` – Tool Implementations
- `text‑editor.ts` – File viewing/editing (str_replace_editor, view_file, create_file).
- `bash.ts` – Shell command execution.
- `search.ts` – File content search (ripgrep).
- `todo.ts` – Todo list management.
- `confirmation.ts` – User confirmation prompts (headless mode auto‑approve).
- `morph.ts` – Optional Morph editor integration.

### `docs/` – Project Documentation
- `ADID_Framework_15_3.md` – ADID framework (required reading for agents).
- `APPLICATION-SCHEME.md` – Module map and file roles.
- `AGENT.md` – Agent flow, tools, RAG, config, MCP.
- `settings.json.md` – All settings and environment variables.
- `HANDOVER.md` – Quick handover for developers.
- `command‑classification.md` – CLI command hierarchy (this iteration).

### `test_data/` – Test Datasets
- `examples.csv` – FACTS Grounding 1.0 dataset (860 examples).
- `evaluation_prompts.csv` – Evaluation prompts.
- `README.md` – Dataset description.

### `test_results/` – Test Outputs (Generated)
- `extracted_docs/` – Extracted context documents (860 `.txt` files).
- `doc_question_mapping.json` – Mapping of document IDs to questions.
- `selected_questions.json` – 5 randomly selected questions (cleaned system instructions).
- `indexing_result.json`, `indexing_result_glove.json` – Indexing statistics.
- `retrieval_results.json`, `retrieval_report.md` – Retrieval test results.
- `grok_qa_results.json`, `grok_qa_report.md` – Grok‑CLI Q/A test results.
- `final_report.md` – Comprehensive test summary.
- `debug_rag_context.ts`, `test_rag_injection.ts` – Debug scripts.

### `tools/` – ADID Update Manager (adm)
- `adm.exe` (Windows) / `adm` (Unix) – Declarative file update tool.
- `adm.md` – adm documentation.
- `src/adm/` – adm source code (if present).

### `logs/` – Log Files
- `verify_report_*.{json,md}` – adm verification reports.
- `*_semgrep_test_timings.log` – Semgrep diagnostic logs.
- `cmd_runner/` – cmd_runner logs (Windows ConPTY).

### `updates/` – ADID Update Descriptors
- `*.xml` – XML descriptors for declarative updates (generated by `adm --template`).

### `data/` – Data Files
- `glove/` – GloVe embedding databases (`glove_50d.db`, etc.).
- `models.json` – Model configurations (context window, reasoning support).

### `scripts/` – Build & Utility Scripts
- `convert-glove-to-sqlite.ts` – Converts GloVe text files to SQLite.
- `build-makerai.ps1` – Builds MakerAI RagManager.exe.

### `MakerAI/` – MakerAI RAG GUI (external subproject)

### `.grok/` – User/Project Settings (Generated)
- `user‑settings.json` – User‑level settings (API key, default model, theme).
- `settings.json` – Project‑level settings (RAG, embeddings, quantization).
- `rag.db` – Vector database (SQLite with chunks and vectors).
- `chat‑history/` – Saved chat sessions.

## Key Changes in Current Iteration (RAG Enhancement)

### 1. Local Embedding Providers
- Added `embedding‑provider‑base.ts`, `embedding‑factory.ts`, and three provider implementations.
- Updated `embedding‑client.ts` to use provider factory.
- Configuration keys: `user.embeddings.model`, `project.rag.embeddings.provider`, `project.rag.embeddings.hashDimension`, `project.rag.embeddings.gloveModelPath`.

### 2. Quantization Settings (Disabled by Default)
- CLI flags `--quantize` and `--preload` added to `grok rag index`.
- Settings manager methods `getRagQuantize()` and `getRagQuantizePreload()`.
- Quantization remains off unless explicitly enabled.

### 3. RAG Context Injection Fix
- Moved `maybeInjectRagContext` call to `processUserMessage` (headless mode) to ensure context is injected before the user message is added to chat history.
- Added debug logging (`GROK_DEBUG_RAG=1`).

### 4. Command Conflict Resolution
- Removed duplicate `index` subcommand from `chat‑history` (only `grok rag index` remains).
- Created `docs/command‑classification.md` to prevent future conflicts.

### 5. Test Suite with FACTS Grounding Dataset
- Extracted 860 context documents, indexed with hash and GloVe embeddings.
- Randomly selected 5 questions, ran Grok‑CLI in headless mode.
- Verified retrieval works (hash deterministic, GloVe semantic).

## Next Steps (Pending)

1. **Verify RAG Integration** – Confirm that injected context is used by the model (not just retrieved).
2. **Clean System Instructions** – Remove template placeholders from test prompts.
3. **Larger GloVe Model** – Use `dolma_300_2024_1.2M.100_combined.txt` for better semantic matching.
4. **Quantization Tests** – Enable quantization and measure performance/accuracy trade‑offs.
5. **Cross‑encoder Reranking** – Improve retrieval relevance with reranking.

---

*Last updated: 2026‑03‑06*