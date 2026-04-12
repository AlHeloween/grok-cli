## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Vector DB Binary BLOB Binding]
**Learning:** Serializing large numerical arrays to JSON for database storage/retrieval is a major performance bottleneck due to CPU-intensive stringification and parsing, plus GC pressure. Using `Float32Array` with direct binary BLOB binding in SQLite-WASM provides a massive speedup (e.g., ~11.8x for insertions, ~2.1x for queries).
**Action:** Use typed arrays and binary formats for high-frequency data transfer between JavaScript and native/WASM extensions.
