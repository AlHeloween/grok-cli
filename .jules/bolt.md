## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Binary Vector Binding for SQLite]
**Learning:** For vector databases using SQLite extensions like `sqlite-vector`, passing vectors as JSON-stringified arrays (`JSON.stringify(vector)`) is a major bottleneck due to serialization overhead. Using direct binary BLOB binding (`Uint8Array` from `Float32Array`) significantly improves performance by bypassing parsing and reducing GC pressure. In this codebase, it yielded a ~3.6x speedup for queries and over ~70x for large-batch insertions (1000 items).
**Action:** Always prefer binary BLOB binding over string serialization when interacting with vector extensions in SQLite.
