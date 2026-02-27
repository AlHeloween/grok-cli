# Grok CLI Bash Tool Instructions & Mentions

**Generated:** From codebase search (rg --type md bash). Focus on agent/Grok guidance.

## Key Contexts (Grok/Agent Instructions)

### AGENTS.md (Line 51)
> - `src/tools/` — Text-editor, bash, search, todo, confirmation, optional Morph.

**Insight:** Bash is a core tool in `src/tools/` for agents (file ops, system commands).

### CONTRIBUTING.md (Security Section)
> ## Security (bash/shell execution)  
> Commands executed via the AI’s bash/shell tool run with **your user privileges** on your machine. The CLI does not execute commands without your confirmation when confirmations are enabled. Always review suggested commands before accepting them; do not approve commands you do not understand or that could modify or delete important data.

**Insight:** Critical safety rule for Grok agents: User confirms bash cmds; review for risks.

### CHANGELOG.md (Unreleased)
> - CONTRIBUTING.md with build/test/lint, branch/PR expectations, code style, and security note for bash/shell execution.

### README.md
- 37 mentions: Mostly ```bash code blocks for setup (bun install, git clone), dev commands, testing.
- Line 635: - **Tools**: Text editor and bash tool implementations
- Line 649-650: macOS/Linux bash/zsh examples.

**Insight:** Bash tool emphasized for cross-platform ops (pref rg over grep/find). Windows: Use dir, rg (as observed).

## Policy/Tool Rules (from Grok CLI System)
- **Bash Usage**: For searching, file discovery, navigation, system ops (git, pkg mgrs). Pref `rg`; avoid on Windows cmd (use dir/pwsh).
- **Confirmation**: Auto-requests user approval for bash cmds.
- **Examples**: `ls -la` → Fails on Win; `dir` succeeds.

## Summary
Bash is a **tool-first** integration for agents. Instructions stress **safety** (confirmations, review), **cross-platform** (rg/sed/dir), and **limited scope** (discovery/ops, not edits—use str_replace_editor).

**Total MD Hits:** AGENTS(2), README(37), CONTRIBUTING(5), etc.