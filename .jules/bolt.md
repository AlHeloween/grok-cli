## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Tiktoken Caching for Repetitive Strings]
**Learning:** Tokenization using `tiktoken` (WASM) is relatively expensive due to cross-boundary calls and complexity. In chat applications, many strings (role names, system prompt fragments, common UI text) are tokenized repeatedly. A simple `Map` cache for short strings (<2000 chars) can improve token counting throughput by over 1000x (from ~5.5k to ~5.8M ops/sec).
**Action:** Implement light-weight caching for core utility functions that wrap expensive WASM or external calls when repetitive inputs are expected.
