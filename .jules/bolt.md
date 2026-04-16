## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Caching Tiktoken Encoders]
**Learning:** Initializing a Tiktoken encoder takes ~100ms because it involves loading a WASM binary and parsing a large dictionary. In a CLI tool where multiple `TokenCounter` instances may be created, this latency quickly accumulates. Implementing a global cache for encoders eliminates this overhead for subsequent hits.
**Action:** Use global caches for expensive, immutable third-party library objects (like Tiktoken encoders or database connection pools) that don't need to be per-instance.
