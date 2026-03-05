## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Eliminating Per-Call Allocations for Bit-Casting]
**Learning:** Frequent allocation of small `ArrayBuffer` and `TypedArray` objects for bit-level manipulation (like FP32/FP16 conversion) is extremely expensive in JavaScript hot loops. This causes significant GC pressure and slows down computation by several orders of magnitude.
**Action:** Use shared module-level buffers for bit-level conversions to eliminate allocation overhead. Ensure the logic is synchronous and does not contain `await` or `yield` points to maintain safety in single-threaded environments.
