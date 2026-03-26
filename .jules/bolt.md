## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-07-22 - [Loop Unrolling for Dot Product]
**Learning:** In numerical computations like dot products, the bottleneck is often the serial dependency of the accumulator. Using multiple accumulators (e.g., sum0-sum7) in an unrolled loop allows the CPU to leverage Instruction-Level Parallelism (ILP), effectively hiding the latency of floating-point additions.
**Action:** Use 8-way loop unrolling with multiple accumulators for tight numerical loops in performance-critical paths.
