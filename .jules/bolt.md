## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-03-02 - [Token Counter Caching Speedup]
**Learning:** Repetitive token counting (e.g. for message roles or common system prompt parts) can be a significant bottleneck if done repeatedly in a tight loop. Implementing a simple LRU/FIFO cache for short strings in the `TokenCounter` provides a ~1500x speedup for those specific calls.
**Action:** Use caching for deterministic, computationally expensive operations on small inputs that are likely to repeat.
