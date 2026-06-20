## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Caching Repetitive Tokenization Calls]
**Learning:** WASM-based tokenization (via `tiktoken`) is a relatively expensive operation that can become a bottleneck when processing many small, repetitive strings like chat role names ('user', 'assistant') or common UI elements. Implementing a simple `Map`-based cache for these strings provides a massive speedup (~1500x) for repetitive lookups without introducing significant memory overhead if bounded (e.g., max 1000 entries).
**Action:** Use memoization for deterministic, high-frequency utility functions that involve cross-boundary calls (like JS to WASM) to reduce overhead in hot paths.
