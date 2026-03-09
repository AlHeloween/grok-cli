## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-03-05 - [Shared Buffers for Numerical Conversions]
**Learning:** High-frequency numerical conversions (like FP32 to FP16) in TypeScript can be significantly bottlenecked by the allocation of temporary `ArrayBuffer` and `TypedArray` objects. Using module-level shared buffers and views can eliminate GC pressure and provide massive throughput gains (~60x in this case).
**Action:** Use shared module-level buffers for bitwise manipulation of primitives when performance is critical.
