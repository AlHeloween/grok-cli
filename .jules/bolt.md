## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Optimizing Text Utilities with Native Index Methods]
**Learning:** Common text manipulation patterns like `slice().split('\n')` or `slice().indexOf()` are inefficient on large strings because they create intermediate string copies and arrays, leading to O(N) space overhead and high GC pressure. Replacing them with native `indexOf()` and `lastIndexOf()` using the `fromIndex` (position) argument reduces space complexity to O(1) and significantly improves performance.
**Action:** Avoid slicing strings for position-based searches; always use the `fromIndex` argument of native string search methods to perform lookups within the original buffer.
