## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-15 - [Optimizing Text Navigation with Native Index Lookups]
**Learning:** Functions like `getTextPosition`, `moveToLineStart`, and `moveToLineEnd` often use `slice().split('\n')` or `slice().indexOf()`. For large files, this causes O(N) memory allocations and unnecessary CPU overhead. Using native `indexOf` and `lastIndexOf` with the `fromIndex` parameter allows for in-place scanning within the original string buffer, providing significant speedups (up to 14x in benchmarks).
**Action:** Avoid `slice()` when performing character or substring lookups; always prefer native search methods that support a start/end position.
