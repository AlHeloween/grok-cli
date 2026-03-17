## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2024-05-20 - [Avoid string slicing/splitting in text processing]
**Learning:** Functions like `getTextPosition`, `moveToLineStart`, and `moveToLineEnd` are often called frequently in terminal UI applications. Using `text.slice(0, index).split('\n')` or `text.slice(index).indexOf('\n')` creates large temporary strings and arrays, leading to O(N) memory allocation and GC pressure.
**Action:** Use `indexOf` and `lastIndexOf` with the optional `fromIndex` (or offset) parameter to scan the original string directly without creating copies.
