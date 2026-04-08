## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-04-08 - [Optimized Batching in Chat Indexer]
**Learning:** The `indexChatHistory` function was performing sequential embedding API calls for each entry, leading to high latency. Refactoring it to use `embedBatch` consolidated these into a single network request. When updating such code, corresponding unit tests MUST be updated to mock and verify the batch method instead of the single-embed method to avoid test failures.
**Action:** Consolidated sequential API calls into batch calls wherever possible and ensured test parity by updating mocks.
