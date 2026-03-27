## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Binary BLOB Binding for Vector Data]
**Learning:** Using `JSON.stringify` to bind large floating-point arrays (vectors) to SQLite `vector_as_f32` is a massive performance bottleneck. In this codebase, switching to direct binary `Uint8Array` (BLOB) binding for 1536-dimensional vectors resulted in a ~77x speedup for insertions and a ~2.4x speedup for similarity queries.
**Action:** Always prefer binary BLOB binding over JSON serialization when passing large numerical arrays to database drivers or native extensions.
