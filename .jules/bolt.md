## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Binary BLOB Binding for SQLite Vectors]
**Learning:** Passing vectors as JSON strings to `@sqliteai/sqlite-wasm` via `vector_as_f32(?)` is a major performance bottleneck. Stringification in JS and parsing in the SQLite extension's C code adds massive overhead. Binding vectors as raw binary `Uint8Array` (Float32 values) eliminates this overhead.
**Action:** Always use binary BLOB binding for high-dimensional vectors in SQLite to achieve significant speedups (e.g., ~10x for insertions and ~2x for queries).
