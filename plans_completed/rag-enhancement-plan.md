# RAG Enhancement Plan

## Goal
Enhance the Grok CLI's RAG system to support local embedding providers (GloVe averaging and hash‑based) alongside the existing OpenAI‑compatible API, eliminating dependency on external embedding APIs. Quantization must remain disabled by default and configurable via CLI flags (`--quantize`, `--preload`) and TUI menu (`/config` → RAG category). The system must be tested on a real dataset (FACTS Grounding 1.0).

## Requirements

1. **Local embedding providers**:
   - OpenAI‑compatible API (default, existing)
   - GloVe averaging (local, SQLite word vectors)
   - Hash embeddings (local, deterministic hash‑based)

2. **Quantization settings**:
   - Disabled by default
   - Configurable via CLI flags (`--quantize`, `--preload`)
   - Configurable via TUI menu (`/config` → RAG category)
   - CLI flags override configuration (precedence: CLI > environment > project > user > defaults)

3. **Backward compatibility**:
   - Existing OpenAI provider must continue to work
   - No breaking changes to existing RAG workflows

4. **Testing**:
   - Index the FACTS Grounding 1.0 dataset (`test_data/examples.csv`)
   - Randomly select 5 questions
   - Run grok‑cli in headless mode to answer them
   - Publish results in `test_results/` folder

5. **Documentation**:
   - Create `DOCIndex.md` explaining every file in the directory
   - Create command classification plan to avoid naming conflicts
   - Update `AGENTS.md` with new folder structure (plans/, insights/)

## Implementation Tasks

### Phase 1: Architecture & Configuration
- [x] Design embedding provider interface (`EmbeddingProviderBase`)
- [x] Create factory (`EmbeddingFactory`) to instantiate providers from settings
- [x] Update configuration registry with embedding and quantization keys
- [x] Extend settings manager with `getRagQuantize()` and `getRagQuantizePreload()`
- [x] Add CLI flags (`--quantize`, `--preload`) to `grok rag index` command

### Phase 2: Provider Implementations
- [x] Implement `OpenAIEmbeddingProvider` (existing functionality)
- [x] Implement `GloveEmbeddingProvider` (loads SQLite GloVe database, tokenizes, averages)
- [x] Implement `HashEmbeddingProvider` (deterministic hash‑based embeddings)
- [x] Update `EmbeddingClient` to use provider factory
- [x] Update `Indexer` and `Retriever` to respect quantization settings

### Phase 3: Integration & Bug Fixes
- [x] Fix RAG context injection timing (`maybeInjectRagContext` called after user message)
- [x] Add debug logging (`GROK_DEBUG_RAG=1`)
- [x] Resolve model compatibility (`grok‑code‑fast‑1` → `grok‑4‑latest` for RAG)
- [x] Fix TypeScript errors in `grok‑agent.ts` and test files
- [x] Remove template placeholders from system instructions

### Phase 4: Testing & Validation
- [x] Extract 860 context documents from FACTS dataset
- [x] Index with hash embeddings (7,244 chunks)
- [x] Index with GloVe embeddings (re‑index for semantic retrieval)
- [x] Run retrieval tests for both providers
- [x] Execute grok‑cli Q/A tests for 5 random questions
- [x] Generate comprehensive reports (`final_report.md`)

### Phase 5: Documentation & Organization
- [x] Create `DOCIndex.md` with project structure
- [x] Create CLI command classification plan (`command‑classification.md`)
- [x] Create insights document (`insights/rag‑enhancement‑insights.md`)
- [x] Update `AGENTS.md` with new folder structure
- [x] Move completed plans to `plans_completed/`

## Completed Deliverables

### Code
- `src/rag/embedding‑provider‑base.ts`
- `src/rag/embedding‑factory.ts`
- `src/rag/embedding‑providers/` (openai‑provider.ts, glove‑provider.ts, hash‑provider.ts)
- Updated `src/rag/embedding‑client.ts`, `indexer.ts`, `retriever.ts`, `vector‑db.ts`
- Updated `src/agent/grok‑agent.ts` (RAG injection fix)
- Updated `src/index.ts` (CLI flags)
- Updated `src/utils/settings‑manager.ts`, `src/config/registry.ts`

### Configuration
- New keys: `user.embeddings.model`, `project.rag.embeddings.provider`, `project.rag.embeddings.hashDimension`, `project.rag.embeddings.gloveModelPath`
- Quantization getters: `getRagQuantize()`, `getRagQuantizePreload()`

### Test Results
- `test_results/extracted_docs/` (860 `.txt` files)
- `test_results/doc_question_mapping.json`
- `test_results/selected_questions.json` (5 cleaned questions)
- `test_results/indexing_result.json`, `indexing_result_glove.json`
- `test_results/retrieval_results.json`, `retrieval_report.md`
- `test_results/grok_qa_results.json`, `grok_qa_report.md`
- `test_results/final_report.md`

### Documentation
- `DOCIndex.md` (project structure)
- `docs/command‑classification.md` (CLI hierarchy)
- `insights/rag‑enhancement‑insights.md` (key learnings)
- Updated `AGENTS.md` (folder structure)

## Verification

- [x] `bun run build` succeeds
- [x] `bun run typecheck` passes (except known unrelated errors)
- [x] `grok rag index --quantize` and `--preload` flags work
- [x] `grok rag status` shows correct quantization settings
- [x] RAG retrieval works with hash and GloVe providers
- [x] Grok‑CLI answers questions using retrieved context (debug logs confirm)
- [x] No command conflicts (`grok rag index` only)

## Next Steps (Future)

1. **Larger GloVe model**: Use `dolma_300_2024_1.2M.100_combined.txt` for better semantic matching.
2. **Quantization benchmarks**: Enable quantization and measure performance/accuracy trade‑offs.
3. **Cross‑encoder reranking**: Improve retrieval relevance with reranking.
4. **Hybrid search**: Combine semantic and keyword retrieval.
5. **Batch testing**: Automate testing across all 860 examples.

## Status
**COMPLETED** (2026‑03‑06)

Moved to `plans_completed/` after final verification.