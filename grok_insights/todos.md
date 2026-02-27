# Grok CLI Open Todos

**Updated:** February 27, 2026  
**Status:** Checked against current project state. Completed items marked [x] ✅

## High Priority 🔴 Cleanup & Hygiene
- [ ] Delete `nul` file (`rm nul`)
- [ ] Update `.gitignore` to include:
  | Pattern | Reason |
  |---------|--------|
  | `__pycache__/ ` | Python caches |
  | `*.pyc` `*.pyo` | Bytecode |
  | `*.backup_*` | IDE backups |
  | `*.adid.log.jsonl` | Logs |
  | `*.baseline` | Lint baselines |
  | `.ruff_cache/` | Ruff cache |
  | `coverage/` | Test coverage (optional) |
  | `nul` | Windows artifact |
- [ ] `git add .gitignore &amp;&amp; git commit -m &quot;Update gitignore for caches/clutter&quot;`
- [ ] Clean caches/clutter: `rm -rf __pycache__ .ruff_cache coverage/` (selective rm backups/logs)
- [ ] `git clean -fd` (⚠️ caution: reviews untracked first)
- [ ] Handle modified files: review/commit UI changes (`src/ui/*`, `src/index.ts`) or stash/revert

## Medium Priority 🟡 Setup & Fixes
- [ ] Create `pyproject.toml` for Ruff:
  ```
  [tool.ruff]
  line-length = 88
  target-version = &quot;py39&quot;
  [tool.ruff.lint]
  select = [&quot;E&quot;, &quot;F&quot;, &quot;B&quot;, ...]
  ignore = []
  ```
- [ ] `ruff check . --fix`
- [ ] `npm audit fix` (or manual)
- [x] **Tests exist &amp; pass** (32 Vitest) ✅

## UI Fixes 🟡 (Summary from `ui_issues.md`)
- [ ] **Screen flashing:** Debounce Ink `render()` cycles (use `useEffect` guards, `setTimeout`)
- [ ] **Copy/paste broken:** Enhance `useInput`/`useEnhancedInput`; add terminal selection support (`process.stdin.setRawMode`)
- [ ] **Input lag:** Optimize hooks (`use-input-handler.ts`)
- [ ] **Markdown rendering:** Fix `marked-terminal` overflows
- [ ] Potential: Switch to lighter UI lib (e.g., `cli-table3`, Ink multi-render)

## Low Priority 🟢 Improvements
- [ ] **Refactor `src/index.ts`:** Split into CLI setup, agent init, UI render (1200+ lines)
- [ ] **Lint strict:** Fix ESLint `any` types
- [ ] **CI/CD:** GitHub Actions for test/lint/build
- [ ] **Docs:** Update CHANGELOG, add Python setup
- [ ] **Performance:** Tool caching, RAG batching polish
- [ ] **Cross-platform tests:** Linux/macOS (Python kernels)
- [ ] **Publish:** npm release (`grok-cli` bin)

---
*Track here. Use Git for changes.*
