# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Older history can be inferred from git tags and commits.

## [Unreleased]

### Added

- Truncation message when input is capped at 100,000 characters (chat history entry with removed count).
- CONTRIBUTING.md with build/test/lint, branch/PR expectations, code style, and security note for bash/shell execution.
- Test coverage script (`bun run test:coverage`) and Vitest v8 coverage config; README Testing section updated.
- JSDoc on public APIs (GrokClient, clipboard-image, useEnhancedInput); CHANGELOG and TypeDoc script for API docs.
- Web search via Agent Tools (Responses API + web_search) documented; legacy Chat Completions do not use search_parameters (410 fix).
- Optional: default model, reasoning `include`, and higher `max_output_tokens` for Grok 4.1 Fast.
- Async clipboard image check: paste uses async `getClipboardImage()` and only swallows paste when an image is found; text paste inserts when the promise resolves, with ordering/queue to avoid duplicate insert.
  - Interactive RAG management menu (`/rag` command) with search, delete, export/import, pagination, and GUI integration.
  - Chat session restoration: `--load-chat-session <sessionId>` flag and `/restore` interactive command.
  - Increased CLI command suggestions limit from 8 to 20 for better navigation.

### Changed- Interactive RAG management menu (`/rag` command) with search, delete, export/import, pagination, and GUI integration.

### Changed

- (None in this batch.)

### Fixed

- Clipboard paste now inserts text correctly when special key handler returns false synchronously.
- CLI command suggestions now show up to 20 items (increased from 8) for better navigation.

## [0.34.0] and earlier

See git history for prior changes.

<!-- ADID_ROLLBACK (from adm.exe)
  SDID_ROLLBACK {
    "target_file": "D:\\zPython\\grok-cli\\CHANGELOG.md"
    "update_script": "adm.exe"
    "backup_path": "D:\\zPython\\grok-cli\\CHANGELOG.md.backup_20260304T032103_009189"
    "created_at": "2026-03-03T19:21:03.026770+00:00"
    "backup_hash": "c58e3bb287ddbcc22fa3741adca54a37"
    "new_hash": "8b79d3abc2df7cc436b42e8385f15be6"
    "goal_id": "text_anchor_replace"
    "semantics": "Add paste and CLI options fixes to changelog."
    "update_attrs": {"relative_path": "CHANGELOG.md", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "### Fixed\n\n- (None in this batch.)", "replace_present": true}
    "restore_cmd": "uv run adm \u002d\u002drollback \"D:\\zPython\\grok-cli\\CHANGELOG.md\""
  }
-->
