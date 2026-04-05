## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-15 - [Binary Vector Binding in SQLite]
**Learning:** Using `JSON.stringify` for high-dimensional vectors (e.g., 1536D) when interacting with SQLite vector extensions creates a significant CPU bottleneck. Direct binary binding using `Uint8Array` (viewing a `Float32Array`) bypasses expensive serialization in JS and parsing in C/C++, yielding up to 10x faster insertions.
**Action:** Always prefer raw binary BLOBs over JSON for numerical arrays when the underlying storage engine (like sqlite-vec) supports it.
