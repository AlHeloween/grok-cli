## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-04-15 - [Loop Unrolling for Batch Dot Product]
**Learning:** Manual 8-way loop unrolling with multiple accumulators in hot numerical loops (like dot product) provides a significant performance boost (~47% in this case) on modern JS engines by leveraging instruction-level parallelism. This is especially effective when processing large batches of vectors stored in flat arrays.
**Action:** Identify bottlenecks in mathematical kernels and apply unrolling with independent accumulators to bypass data dependency bottlenecks.
