## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-04-09 - [Optimizing Local Embedding Retrieval]
**Learning:** Sequential database lookups for word vectors (N+1 query problem) can be a major bottleneck in local embedding providers like GloVe. Implementing a `prefetch` mechanism using the SQLite `IN` clause significantly reduces overhead. Additionally, using `Float32Array` for vector summation and implementing negative caching (storing `null` for missing words) eliminates redundant allocations and database hits.
**Action:** When a provider processes tokens or chunks in a loop, always implement a pre-fetch or batch-fetch phase to consolidate database or API interactions.
