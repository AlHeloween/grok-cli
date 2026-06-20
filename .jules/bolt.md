## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-20 - [Caching Token Counts]
**Learning:** Token counting via libraries like `tiktoken` is computationally expensive because it often involves WebAssembly calls. In applications with long chat histories or high-frequency updates, re-counting tokens for the same strings (like message roles or static prompt segments) is a major bottleneck. A simple Map-based cache with a size limit and string length threshold can provide a significant speedup (e.g., 2.5x in benchmarks) with minimal memory overhead.
**Action:** Always consider caching the results of expensive, deterministic transformations like tokenization when the same inputs are likely to be processed repeatedly.
