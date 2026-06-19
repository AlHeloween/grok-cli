## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Re-optimizing Text Utilities after Rollbacks]
**Learning:** Core text utility optimizations (replacing `slice().split()` with `indexOf`) in `src/utils/text-utils.ts` were previously implemented but reverted by automated tools (`ADID_ROLLBACK`). These functions are critical for performance when handling large documents in RAG.
**Action:** Always check for rollback metadata when identifying performance bottlenecks, as high-impact optimizations may have been previously identified but accidentally reverted.
