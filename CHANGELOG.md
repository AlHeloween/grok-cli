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

### Changed

- (None in this batch.)

### Fixed

- (None in this batch.)

## [0.34.0] and earlier

See git history for prior changes.
