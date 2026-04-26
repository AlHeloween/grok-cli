## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-04-26 - [Ensuring 1:1 Mapping in Batch Embeddings]
**Learning:** Batch embedding implementations that filter out empty strings (like the original OpenAiEmbeddingProvider) break the 1:1 mapping between input texts and output vectors, leading to index mismatches for callers.
**Action:** Always use an index map in batch embedding providers to ensure the returned array matches the input array's length and order, filling empty/invalid slots with default values or empty arrays.
