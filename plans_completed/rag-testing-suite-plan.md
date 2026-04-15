# RAG Testing Suite Plan

## Goal
Create an automated testing suite for RAG functionality accessible via CLI command `grok rag test`. The suite should:
1. Test end‑to‑end RAG workflows (indexing, retrieval, context injection)
2. Support both hash and GloVe embedding providers
3. Test with and without quantization
4. Output human‑readable results (✅/❌) with optional JSON format
5. Integrate with existing Vitest infrastructure while being callable from CLI

## Requirements

### Functional
1. **CLI command**: `grok rag test` with options:
   - `--provider <hash|glove>` (default: hash)
   - `--quantize` (test quantization path)
   - `--verbose` (detailed output)
   - `--json` (output JSON results)

2. **Test coverage**:
   - Create temporary test directory with sample files
   - Index with specified provider
   - Perform retrieval queries
   - Verify chunk counts and retrieval distances
   - Test quantization when enabled

3. **Integration**:
   - Reuse existing test utilities from `rag-facts.test.ts`
   - Share test data generation logic
   - Maintain separation between CLI parsing and test logic

### Non‑functional
1. **Performance**: Tests should complete within 30 seconds
2. **Reliability**: No external dependencies (use hash provider by default)
3. **Cleanup**: Temporary directories removed after execution
4. **Portability**: Work on Windows, macOS, Linux

## Implementation Tasks

### Phase 1: Extract Test Utilities
- [ ] Create `src/rag/test‑utils.ts` with shared test logic:
  - `createTestFiles(cwd: string): string[]` – create sample text files
  - `runRagTest(options: TestOptions): TestResults` – main test runner
  - `TestOptions` interface (provider, quantize, verbose)
  - `TestResults` interface (success, metrics, errors)

- [ ] Refactor `rag-facts.test.ts` to use shared utilities
- [ ] Ensure TypeScript compatibility and no breaking changes

### Phase 2: Implement CLI Command
- [ ] Add `test` subcommand to `ragCommand` in `src/index.ts`
- [ ] Parse CLI options and call `runRagTest()`
- [ ] Format output: human‑readable (default) and JSON (`--json`)
- [ ] Handle errors gracefully with appropriate exit codes

### Phase 3: Create CLI‑Specific Tests
- [ ] Add `src/rag/cli.test.ts` that tests the CLI command:
  - Spawn `grok rag test` as child process
  - Verify exit codes and output
  - Test different option combinations
- [ ] Ensure new tests pass existing test suite

### Phase 4: Documentation & Validation
- [ ] Update `grok rag test --help` documentation
- [ ] Add example usage to `README.md` or `DOCIndex.md`
- [ ] Run full test suite: `bun run test`, `bun run typecheck`, `bun run lint`
- [ ] Test manually: `grok rag test --provider hash --verbose`

## Technical Design

### Command Structure
```
grok rag test [options]

Options:
  --provider <hash|glove>  embedding provider (default: hash)
  --quantize               test with quantization (default: false)
  --verbose                detailed output (default: false)
  --json                   output results as JSON (default: false)
  -h, --help               display help
```

### Test Flow
1. Create temporary directory in system temp location
2. Generate 5-10 sample text files with varied content
3. Index with specified provider (and quantization if `--quantize`)
4. Perform 3-5 retrieval queries
5. Verify:
   - Correct chunk count
   - Retrieval returns results
   - Distances are within expected range
   - No SQL errors (graceful fallback)
6. Clean up temporary directory
7. Output results

### Error Handling
- Exit code 0: All tests passed
- Exit code 1: Test failures
- Exit code 2: Invalid arguments or setup errors
- Clear error messages indicating what failed

## Dependencies
- Uses existing `indexProject()` and `retrieveTopK()` functions
- Leverages current embedding provider infrastructure
- No new external dependencies required

## Success Criteria
1. `grok rag test` runs without errors
2. Tests pass with hash provider (offline)
3. Tests pass with GloVe provider if database exists
4. Quantization tests work when enabled
5. JSON output valid and parsable
6. Existing test suite still passes
7. No regression in RAG functionality

## Timeline
- **Phase 1**: 1-2 hours
- **Phase 2**: 1 hour
- **Phase 3**: 1-2 hours
- **Phase 4**: 1 hour

**Total**: 4-6 hours

## Risks & Mitigations
- **Risk**: CLI tests interfering with existing tests
  - **Mitigation**: Use unique temp directory names, clean up thoroughly
- **Risk**: Performance impact on existing test suite
  - **Mitigation**: Keep test data minimal, focus on integration paths
- **Risk**: Platform‑specific issues (Windows file paths)
  - **Mitigation**: Use `path` module, test on multiple platforms if possible

## Future Extensions
1. **Benchmark mode**: Measure indexing/retrieval speed
2. **Accuracy testing**: Use FACTS Grounding dataset for semantic accuracy
3. **Comparative testing**: Run same tests across different providers
4. **CI integration**: Output JUnit XML for CI systems

---

*Created: 2026‑03‑06*