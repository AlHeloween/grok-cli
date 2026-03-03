---
title: "Root Directory File Index"
owner: "opencode@deepseek.com"
status: "production"
surface: "root_documentation"
last_verified: "2026-03-02"
tags: ["documentation", "index", "project-structure"]
related_code:
  - "src/index.ts"
  - "package.json"
  - "tools/adm.exe"
summary: "Index of all root directory files with explanations of purpose and project alignment."

# REQUIRED for 'production', 'test', or 'execution' status
reproduce:
  files:
    - "index.md"
    - "package.json"
    - "README.md"
  commands:
    - "ls -la"
  inputs:
    - "package.json@sha256:$(sha256sum package.json | cut -d' ' -f1)"
  expected_outputs:
    - "index.md contains accurate file descriptions"
    - "All core project files present in root"
---

# Root Directory File Index

## Core Project Files

### `package.json`
**Purpose**: Node.js/Bun project configuration, dependencies, and scripts.
**Alignment**: Defines the project as a TypeScript CLI application with grok-cli as main entry point. Contains build, test, lint, and development scripts.
**Status**: Production (required for build).

### `bun.lock`
**Purpose**: Bun lockfile for deterministic dependency installation.
**Alignment**: Ensures reproducible builds across environments.
**Status**: Production.

### `tsconfig.json`
**Purpose**: TypeScript compiler configuration.
**Alignment**: Configures TypeScript for ESM output, strict type checking, and compatibility with Bun runtime.
**Status**: Production.

### `vitest.config.ts`
**Purpose**: Vitest test runner configuration.
**Alignment**: Configures unit testing for the project with coverage reporting.
**Status**: Production.

### `eslint.config.cjs`
**Purpose**: ESLint configuration for code quality.
**Alignment**: Enforces TypeScript/JavaScript coding standards and prevents common errors.
**Status**: Production.

### `_build.cmd`
**Purpose**: Windows build script.
**Alignment**: Provides Windows-compatible build command for CI/CD or manual builds.
**Status**: Production.

## Documentation

### `README.md`
**Purpose**: User-facing documentation for installation, usage, features (RAG, MCP, config).
**Alignment**: Primary entry point for users and contributors.
**Status**: Production.

### `AGENTS.md`
**Purpose**: Operational rules for AI agents working on this project.
**Alignment**: Contains ADID framework guidelines, skill definitions, and agent workflows.
**Status**: Production (copied to `.opencode/` for agent access).

### `CONTRIBUTING.md`
**Purpose**: Guidelines for contributors (build, test, lint, style).
**Alignment**: Ensures consistent development practices.
**Status**: Production.

### `CHANGELOG.md`
**Purpose**: Record of version changes.
**Alignment**: Tracks project evolution and breaking changes.
**Status**: Production.

### `LICENSE`
**Purpose**: MIT License for the project.
**Alignment**: Legal licensing terms.
**Status**: Production.

### `extra_rules_for_all_agents.md`
**Purpose**: Universal documentation standards for all agents (YAML frontmatter, reproduce blocks).
**Alignment**: Ensures consistent documentation across the project following the DOCINDEX schema.
**Status**: Production (reference for documentation standards).

## Configuration & Environment

### `.env.example`
**Purpose**: Example environment variables template.
**Alignment**: Shows required environment variables for API keys and configuration.
**Status**: Production.

### `.eslintrc.js`
**Purpose**: Legacy ESLint configuration (superseded by eslint.config.cjs).
**Alignment**: Backward compatibility.
**Status**: Obsolete (kept for compatibility).

### `.gitignore`
**Purpose**: Git ignore patterns for build artifacts, logs, node_modules, etc.
**Alignment**: Prevents committing generated files.
**Status**: Production.

### `.gitattributes`
**Purpose**: Git attribute settings (line endings, diff behavior).
**Alignment**: Ensures consistent line endings across platforms.
**Status**: Production.

### `.npmignore`
**Purpose**: NPM publish ignore patterns.
**Alignment**: Controls which files are included in published package.
**Status**: Production.

## Directories

### `src/`
**Purpose**: Source code for grok-cli application.
**Alignment**: Contains all TypeScript modules (CLI, UI, agent, RAG, tools, config, MCP).
**Status**: Production.

### `tools/`
**Purpose**: Command-line tools for development and ADID framework.
**Alignment**: Contains `adm.exe` (ADID Update Manager), `cmd_runner.exe`, `rg.exe`, `sed.exe`, `apply_patch.exe`.
**Status**: Production.

### `scripts/`
**Purpose**: Utility scripts for benchmarks, testing, and automation.
**Alignment**: Contains FP16 benchmark, SIMD benchmark, and other utility scripts.
**Status**: Production.

### `docs/`
**Purpose**: Project documentation (application scheme, agent guidelines, settings, ADID framework).
**Alignment**: Detailed technical documentation for developers and agents.
**Status**: Production.

### `updates/`
**Purpose**: ADID update descriptors for declarative file changes.
**Alignment**: Contains XML descriptors for traceable, rollback-safe file modifications.
**Status**: Production.

### `logs/`
**Purpose**: Log files from execution, verification, and debugging.
**Alignment**: Stores `_progress_log.md`, verify reports, cmd_runner logs, and debug logs.
**Status**: Production.

### `data/`
**Purpose**: Data files for testing and examples.
**Alignment**: Contains sample data for RAG indexing and testing.
**Status**: Production.

### `dist/`
**Purpose**: Built/compiled output directory.
**Alignment**: Contains compiled JavaScript from TypeScript build.
**Status**: Production (generated).

### `coverage/`
**Purpose**: Test coverage reports.
**Alignment**: Generated by `bun run test:coverage`.
**Status**: Production (generated).

### `node_modules/`
**Purpose**: Node.js/Bun dependencies.
**Alignment**: Installed packages from package.json.
**Status**: Production (generated).

### `.temp/`
**Purpose**: Temporary/experimental files quarantine.
**Alignment**: Contains experimental code, debug scripts, and temporary files that should not clutter project root.
**Status**: Research (quarantine directory).

### `aurora_genesis_core/`
**Purpose**: Aurora-Genesis hypercomplex algebra reference implementation (Python).
**Alignment**: Reference algorithms for fractal geometry and manifold optimization (Option C porting source).
**Status**: Research (reference only, not integrated).

### `MakerAI/`
**Purpose**: MakerAI integration components.
**Alignment**: Contains MakerAI export/import utilities for RAG database.
**Status**: Production.

### `cmd_runner_pkg/`
**Purpose**: cmd_runner package dependencies.
**Alignment**: Windows ConPTY command runner package.
**Status**: Production.

## Hidden Directories (Dotfiles)

### `.codex/`
**Purpose**: Codex editor configuration and rules.
**Alignment**: Contains agent rules for Codex editor integration.
**Status**: Production.

### `.cursor/`
**Purpose**: Cursor editor configuration and rules.
**Alignment**: Contains agent rules for Cursor editor integration.
**Status**: Production.

### `.opencode/`
**Purpose**: OpenCode agent configuration, skills, and rules.
**Alignment**: Contains skills (adm-exe, cmd-runner, rag, etc.) and agent assets.
**Status**: Production.

### `.grok/`
**Purpose**: Grok API client configuration.
**Alignment**: Contains Grok API settings and cache.
**Status**: Production.

### `.jules/`
**Purpose**: Jules AI assistant configuration.
**Alignment**: Contains Jules-specific settings.
**Status**: Production.

### `.github/`
**Purpose**: GitHub workflows and templates.
**Alignment**: Contains CI/CD workflows and issue/PR templates.
**Status**: Production.

### `.ruff_cache/`
**Purpose**: Ruff linter cache.
**Alignment**: Performance optimization for Python linting.
**Status**: Production (generated).

## Utility Files

### `cmd_runner.py`
**Purpose**: Python wrapper for cmd_runner.exe (Windows ConPTY).
**Alignment**: Provides safe interactive command execution with logging.
**Status**: Production (part of toolset).

### `_progress_log.md`
**Purpose**: ADID progress log from adm.exe operations.
**Alignment**: Tracks file updates, rollbacks, and verification results.
**Status**: Production (generated).

### `nul`
**Purpose**: Empty file (likely created by Windows commands).
**Alignment**: Artifact from command execution.
**Status**: Obsolete (can be deleted).

## File Alignment & Cleanup Status

All experimental files (`temp_*.ts`, `temp_*.js`, `new_*.txt`, `new_*.xml`, `*.sed`, `*.txt` documentation drafts) have been moved to `.temp/` quarantine directory to keep project root clean.

The `.temp/` directory serves as:
- **Quarantine zone** for experimental code
- **Debug script archive** for future reference
- **Temporary file storage** during active development

**Maintenance Rule**: Periodically review `.temp/` contents and delete obsolete files or promote useful utilities to `scripts/` directory.

## Verification

To verify root directory integrity:
```bash
# Check core files exist
ls -la package.json bun.lock tsconfig.json README.md AGENTS.md

# Check .temp contains only experimental files
ls -la .temp/ | grep -v "^\." | head -10

# Verify no temporary files in root
find . -maxdepth 1 -name "temp_*" -o -name "new_*" -o -name "debug_*" | grep -v "./.temp"
```

Last updated: 2026-03-02 by opencode agent.