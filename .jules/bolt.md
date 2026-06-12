## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Loop Unrolling with Multiple Accumulators]
**Learning:** For performance-critical numerical loops in JavaScript (V8), loop unrolling combined with multiple accumulators can significantly improve performance (~39% in `batchDotProductFlat`). This works by reducing loop overhead and, more importantly, allowing the JIT to leverage instruction-level parallelism by breaking dependency chains on a single accumulator.
**Action:** Consider loop unrolling and multiple accumulators for hot numerical paths where data is processed in bulk.
