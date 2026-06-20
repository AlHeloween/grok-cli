## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-20 - [Caching Tiktoken Encoders]
**Learning:** Initializing a `tiktoken` encoder is an expensive operation (~150ms) because it involves loading WASM and large vocabulary files. In environments where `TokenCounter` (or similar classes) are instantiated frequently, this latency accumulates.
**Action:** Use a global cache (Map) for `Tiktoken` instances keyed by model or encoding name. Ensure that `dispose()` (or `free()`) is not called on shared/cached instances to prevent invalidating them for other consumers.
