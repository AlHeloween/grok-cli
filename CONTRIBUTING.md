# Contributing to Grok CLI

Thank you for your interest in contributing. This document covers how to build, test, and submit changes.

## Development setup

1. Clone the repository and install dependencies:
   ```bash
   git clone <repository-url>
   cd grok-cli
   bun install
   ```

2. Build:
   ```bash
   bun run build
   ```

3. Run locally (e.g. after `bun link`):
   ```bash
   grok
   ```

## Build, test, and lint

- **Build:** `bun run build` (or `npm run build`) — compiles TypeScript to `dist/`
- **Typecheck:** `bun run typecheck` — runs `tsc --noEmit`
- **Lint:** `bun run lint` — runs ESLint on `src/`
- **Tests:** `bun run test` — runs Vitest; `bun run test:watch` for watch mode
- **Coverage:** `bun run test:coverage` — runs tests with coverage (if configured)
- **API docs:** `bun run docs` — generates TypeDoc API documentation into `docs/` (optional; add `docs/` to `.gitignore` if you generate locally)

Please ensure `bun run build`, `bun run typecheck`, `bun run lint`, and `bun run test` pass before submitting a PR.

## Branch and PR expectations

- Open a branch for your change (e.g. `feature/your-feature` or `fix/your-fix`).
- Keep changes focused; prefer smaller PRs when possible.
- PRs should pass CI (typecheck, lint, tests).
- Maintainers may request changes; we’ll work with you to get changes merged.

## Code style

- **ESLint:** The project uses ESLint for JavaScript/TypeScript. Run `bun run lint` and fix any reported issues.
- **TypeScript:** Use the project’s existing patterns and types; avoid `any` unless necessary and documented.
- **Theming:** Add or update VS Code-inspired presets in `src/ui/utils/theme.ts` using semantic tokens (prompt, border, text, accent, status) rather than hardcoded per-component colors.

## Security (bash/shell execution)

Commands executed via the AI’s bash/shell tool run with **your user privileges** on your machine. The CLI does not execute commands without your confirmation when confirmations are enabled. Always review suggested commands before accepting them; do not approve commands you do not understand or that could modify or delete important data.

## Questions

If you have questions, open an issue or reach out to the maintainers. Contributions are welcome.
