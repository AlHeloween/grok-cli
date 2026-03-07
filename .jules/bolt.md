## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-03-07 - [Token Counting Cache]
**Learning:** Tokenization using 'tiktoken' is computationally expensive, especially when called repeatedly for the same content (e.g., system prompts, role names). Implementing a simple 'Map' based cache for short strings (<2000 chars) with a FIFO eviction policy (1000 entries) provides a massive performance boost, increasing throughput from ~6k to ~17M ops/sec.
**Action:** Always consider caching for deterministic, high-frequency operations that involve crossing boundaries (like WASM or native modules) or performing complex string processing.
