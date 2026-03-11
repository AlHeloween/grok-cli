## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Memoizing Token Counts to Bypass FFI Overhead]
**Learning:** Tokenization using `tiktoken` (WASM/FFI) is computationally deterministic but carries significant overhead when called frequently (e.g., in chat loops or streaming) due to the boundary cross between JS and the underlying implementation. A simple Map-based cache for common strings (like system prompts or UI labels) can boost throughput by several orders of magnitude (from ~5k ops/sec to ~25M+ ops/sec).
**Action:** Use memoization for deterministic, high-frequency utility functions that involve FFI or complex calculations, provided memory usage is bounded.
