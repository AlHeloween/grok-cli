## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Maintaining 1:1 Index Parity in Batch Operations]
**Learning:** When implementing batching (like `embedBatch`), it's critical to maintain a strict 1:1 index mapping between input items and output results. Filtering out "invalid" inputs (like empty strings) before an API call and returning a shorter result array breaks callers that rely on positional alignment.
**Action:** Use an index-mapping pattern to filter inputs for the API but re-insert results into a correctly-sized and indexed output array.
