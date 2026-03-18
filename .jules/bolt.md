## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-07-22 - [Avoid string slicing for cursor positioning]
**Learning:** Functions like `getTextPosition`, `moveToLineStart`, and `moveToLineEnd` are often called frequently (e.g., on every keystroke or cursor move). Using `text.slice(0, index).split('\n')` or `text.slice(0, index).lastIndexOf('\n')` creates large intermediate string and array allocations, which triggers excessive Garbage Collection on large files.
**Action:** Use `indexOf` and `lastIndexOf` with the optional `fromIndex` parameter to perform searches directly on the original string without slicing.
