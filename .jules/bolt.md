## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-20 - [Optimizing Text Position Lookups]
**Learning:** Functions that calculate line/column positions in large text strings (like `getTextPosition`) can become major bottlenecks if they use `text.slice(0, index).split('\n')`. This pattern creates an unnecessary intermediate string copy and a potentially large array of strings. Using native `indexOf('\n', startPos)` in a loop avoids these allocations, reducing latency from ~565ms to ~145ms for 100 calls on 1MB text.
**Action:** Avoid `slice()` and `split()` when searching for delimiters in large strings. Use native `indexOf` and `lastIndexOf` with the second argument (`fromIndex`) to search within the existing buffer.
