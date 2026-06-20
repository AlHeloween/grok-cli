## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Eliminating Allocation Overhead in Hot-Path Utilities]
**Learning:** High-frequency utility functions (like FP16/FP32 conversion) that allocate small `ArrayBuffer` or `TypedArray` objects on every call create significant Garbage Collection pressure and allocation overhead. In a single-threaded environment like JavaScript, module-level shared buffers can be used to perform these bit-level manipulations without any allocations, resulting in massive speedups (measured ~40x+ for bulk conversions).
**Action:** Identify hot-path functions performing numerical or bitwise operations and replace per-call object allocations with shared pre-allocated buffers.
