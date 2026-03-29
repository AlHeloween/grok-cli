## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-03-29 - [Binary BLOBs for Vector Storage]
**Learning:** Using `JSON.stringify` to serialize numeric vectors (like 1536-dim embeddings) for SQLite storage is extremely slow compared to raw binary BLOBs. High-performance SQLite extensions like `sqlite-vector` can bind directly to `Uint8Array` views of `Float32Array`.
**Action:** Prefer binary BLOB storage for high-frequency numeric data. Use TypedArrays (`Float32Array`) and their underlying `ArrayBuffer` to minimize serialization overhead when interacting with native/WASM databases.
