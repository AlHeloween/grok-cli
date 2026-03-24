## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Optimizing Text Utilities for Large Strings]
**Learning:** Common string manipulation patterns like `text.slice(0, index).split('\n')` or `text.slice(index).indexOf('\n')` are inefficient for large strings because they create new string copies and arrays in memory. Using `indexOf` and `lastIndexOf` with the optional `fromIndex` (or index offset) parameter allows for efficient searching within the original string without extra allocations.
**Action:** When working with large text buffers, prioritize index-based searching (`indexOf`, `lastIndexOf`) over patterns that involve `slice()`, `substring()`, or `split()`.
