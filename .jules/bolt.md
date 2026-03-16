## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Eliminating GC Pressure with Shared Buffers]
**Learning:** For performance-critical numerical conversions (like FP32 to FP16) that occur millions of times, creating new `ArrayBuffer` and `TypedArray` views inside the function body creates significant Garbage Collection pressure. Reusing module-level shared buffers and views for these bitwise manipulations can lead to massive throughput increases (~13-19x in this case).
**Action:** In numerical utility functions, use pre-allocated shared buffers at the module level when performing operations that require temporary `ArrayBuffer` access.
