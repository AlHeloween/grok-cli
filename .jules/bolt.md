## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Loop Unrolling with Multiple Accumulators]
**Learning:** In high-performance numerical JavaScript (V8), 8-way loop unrolling with separate accumulators significantly improves performance (~47% reduction in execution time for dot products) by leveraging Instruction-Level Parallelism (ILP). This breaks the dependency chain and allows the CPU to pipeline operations.
**Action:** Use loop unrolling with multiple accumulators for hot numerical paths like dot products or vector transformations.
