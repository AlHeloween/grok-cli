## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-06-10 - [Caching Token Counts for Repetitive Text]
**Learning:** Tokenization using `tiktoken` (WASM/native) can be a bottleneck when processing many messages or large contexts. Frequently occurring strings like message roles ("user", "assistant"), common instructions, or boilerplate phrases are redundantly tokenized. Implementing a simple memory cache (Map + FIFO eviction) for short strings can yield a ~1500x speedup for those specific lookups.
**Action:** Identify expensive operations that process identical or overlapping data (like tokenization, string parsing, or small computations) and implement bounded caching where redundancy is high.
