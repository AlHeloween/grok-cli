# TUI RAG Testing Plan

## Objective
Validate RAG functionality via interactive TUI using `cmd_runner`. Test embedding provider switching, quantization settings, config menu interactions, RAG indexing, search, and status display.

## Prerequisites
- Grok CLI built (`bun run build`)
- `cmd_runner.exe` available in repo root
- Test dataset (FACTS Grounding 1.0) present in `data/facts_grounding_1.0/`

## Directory Structure
- `test_tui/` – root for TUI test artifacts
  - `logs/` – cmd_runner logs (auto‑created)
  - `conversations/` – stored conversation histories per test scenario
  - `results/` – parsed results and validation reports

## Test Scenarios

### 1. Default Provider Verification
**Goal:** Confirm system defaults to `hash` provider (not OpenAI).
**Steps:**
1. Start fresh TUI session with `cmd_runner`.
2. Send `/config` command, navigate to RAG category, check `embeddings.provider` value.
3. Exit config, send `/rag status` – verify provider line shows `hash`.

### 2. Provider Switching (hash → glove → openai)
**Goal:** Change embedding provider via config menu and verify RAG status updates.
**Steps:**
1. Start TUI session.
2. Send `/config`, navigate to `project.rag.embeddings.provider`, select `glove`.
3. Provide glove model path (use existing `data/glove/glove_50d.db`).
4. Exit config, send `/rag status` – verify provider changed.
5. Repeat for `openai` (requires API key; skip if not available, test error handling).

### 3. Quantization Toggle
**Goal:** Enable/disable quantization and preload via config menu.
**Steps:**
1. Start TUI session.
2. Send `/config`, navigate to `project.rag.quantize`, set `true`.
3. Navigate to `project.rag.quantizePreload`, set `true`.
4. Exit config, send `/rag status` – verify quantization lines.
5. Disable both, verify status.

### 4. Aurora Enhancements
**Goal:** Enable Aurora features and verify status.
**Steps:**
1. Start TUI session.
2. Send `/config`, navigate to `project.rag.aurora.enabled`, set `true`.
3. Set `fractalQuantization`, `dualQuaternionDistance`, `gloveKeywords` to `true`.
4. Set `aurora.gloveModelPath` to existing GloVe DB.
5. Exit config, send `/rag status` – verify Aurora block appears with correct values.

### 5. RAG Indexing & Search
**Goal:** Index FACTS dataset and perform semantic search.
**Steps:**
1. Ensure RAG is enabled (`/config` → `project.rag.enabled` = true).
2. Send `/rag index` – wait for completion.
3. Send `/rag list` – verify chunks appear.
4. Send `/rag search` with query "What is the capital of France?" – verify results.
5. Send `/rag delete *` – clear index.

### 6. Config Menu Navigation (All RAG Keys)
**Goal:** Ensure all 17 RAG config keys have working handlers.
**Steps:**
1. For each key in registry (see list below), navigate via `/config`, select key, enter a valid value, verify success message.
2. Record any missing handlers or errors.

**RAG Config Keys:**
- project.rag.extractor
- project.rag.python
- project.rag.embeddings.provider
- project.rag.embeddings.gloveModelPath
- project.rag.embeddings.hashDimension
- project.rag.quantize
- project.rag.quantizePreload
- project.rag.aurora.enabled
- project.rag.aurora.fractalQuantization
- project.rag.aurora.dualQuaternionDistance
- project.rag.aurora.gloveKeywords
- project.rag.aurora.gloveModelPath
- user.embeddings.provider
- user.embeddings.gloveModelPath
- user.embeddings.hashDimension
- user.rag.quantize
- user.rag.quantizePreload

### 7. UI Status Indicator
**Goal:** Verify RAG status indicator appears in footer (shows on/off and provider).
**Steps:**
1. Start TUI session, observe footer line for "RAG: on (hash)".
2. Toggle RAG enabled via config, verify indicator updates.
3. Change provider, verify indicator updates.

## cmd_runner Commands

### Starting a TUI Session
```bash
cmd_runner.exe start --terminal conhost -- grok
```
- Captures `run_id` and `inbox` path.
- Store `run_id` in `test_tui/current_run.txt`.

### Sending Input Programmatically
```bash
cmd_runner.exe send <run_id> --keys "TEXT:/config,ENTER"
cmd_runner.exe send <run_id> --keys "DOWN,ENTER"
```

### Tailing Output
```bash
cmd_runner.exe tail <run_id>
```

### Stopping Session
```bash
cmd_runner.exe stop <run_id> --reason "test complete"
```

## Success Criteria
- All config handlers respond without "Unknown config key".
- RAG status displays correct provider, quantization, Aurora details.
- Indexing and search return expected results.
- UI indicator reflects current RAG state.
- No crashes or unexpected errors.

## Notes
- Use `GROK_DEBUG_RAG=1` environment variable for detailed logs.
- If OpenAI provider fails due to missing API key, expect graceful error.
- GloVe provider requires `glove_50d.db` file; ensure path exists.
- Hash provider always works (no external dependencies).

## Timeline
1. Set up test environment (10 min)
2. Execute scenarios sequentially (30 min)
3. Collect logs, generate report (10 min)
4. Fix any discovered issues (20 min)

## Risk Mitigation
- If cmd_runner fails, fall back to manual TUI testing with screen recording.
- Backup `.grok/` settings before each test.
- Use `--dry-run` for command sequences before actual execution.