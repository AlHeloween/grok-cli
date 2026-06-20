## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-07-21 - [Caching Token Counts for Repetitive Text]
**Learning:** Tokenization (via tiktoken) of frequent short strings like message roles ("user", "assistant") and common system instructions can become a significant overhead in chat-heavy applications. Implementing a simple Map-based cache for these strings provides a measurable ~1000x-1500x speedup for repetitive content.
**Action:** Identify frequently processed small strings in performance-critical paths and consider memoization/caching to bypass heavy computational libraries.
