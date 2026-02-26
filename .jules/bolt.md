## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [TokenCounter Caching]
**Learning:** Tokenization using tiktoken (or any encoder) is computationally intensive. In chat applications, many strings (role names, system prompts, common phrases) are repeated frequently across different messages or chunks. Adding a simple LRU/FIFO cache for short strings in the `TokenCounter` can yield massive speedups (over 1700x in benchmarks) for repeated calls.
**Action:** Consider caching results for deterministic, expensive computations that are likely to be called with identical inputs in a loop or high-frequency path.
