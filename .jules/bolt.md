## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-20 - [Caching Token Counts for Repetitive Strings]
**Learning:** Token counting via WASM-based encoders (like `tiktoken`) can become a bottleneck when processing large message histories because it's called repeatedly for fixed strings like message roles ("user", "assistant", "system") and common instructions. A simple bounded Map-based cache in `TokenCounter` can improve performance by ~100x for these repetitive calls.
**Action:** Use a small, bounded cache for deterministic computations that are frequently called with identical small inputs, especially when they cross the JS/WASM or JS/Native boundary.
