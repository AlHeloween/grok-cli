## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-20 - [Batching Chat History Embeddings]
**Learning:** Sequential embedding API calls for chat history indexing create a significant bottleneck (N roundtrips). Switching to batch embedding reduces this to 1 roundtrip. However, batch implementations (like OpenAI's) often filter out empty strings, which can break index alignment between the input entries and output vectors if not carefully handled.
**Action:** When implementing batching, always ensure the output array maintains a 1:1 mapping with the input array by manually re-aligning results if the underlying API performs filtering.
