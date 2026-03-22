## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-03-03 - [Caching Tiktoken Encoders]
**Learning:** Instantiating `Tiktoken` encoders (e.g., `cl100k_base`) has a significant latency penalty (~100ms) because it involves loading and processing large BPE rank files. For CLI applications or short-lived sessions that might instantiate several token counters, this cost becomes dominant.
**Action:** Implement a global static cache for `Tiktoken` encoders and reuse them by encoding name. Make `dispose()` a no-op for cached encoders to persist them for the process lifetime.
