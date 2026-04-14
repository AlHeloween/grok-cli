## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-03-05 - [GloVe Batch Embedding Optimization]
**Learning:** The GloVe embedding provider suffered from an N+1 query problem, making a database call for every word in every text during batch processing. By implementing a 'prefetch' method in the SQLite loader using the 'IN' clause and combining it with negative caching for missing words, we can drastically reduce database overhead. Furthermore, using 'Float32Array' for vector accumulation avoids expensive array copies and reduces GC pressure.
**Action:** Always pre-fetch and batch-load dependencies for loop operations. Use TypedArrays for high-frequency numerical calculations.
