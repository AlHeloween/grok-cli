## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Maintaining 1:1 Index Mapping in Batch Embeddings]
**Learning:** When batching embedding calls, some providers (like OpenAI) might filter out empty or invalid strings, which shifts indices and breaks the 1:1 mapping with the input array. It is critical to pre-process inputs, track non-empty indices, and reconstruct the result array to match the input's length and order. Additionally, when batching local SQLite lookups for tokens (e.g., GloVe), ensuring case-insensitive Map lookups is essential if the database tokens were normalized.
**Action:** Always verify that batch operations return results that align perfectly with input indices, and handle normalization consistently across batch fetching and retrieval.
