## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Token Count Memoization for Repetitive Chat Elements]
**Learning:** Repetitive strings like message roles ('user', 'assistant') and system prompt headers are tokenized repeatedly during chat loops. Since `tiktoken` uses a WASM-based encoder, the JS-to-WASM bridge and encoding process can be a bottleneck in high-throughput or long-context scenarios. Bounded memoization provides a massive (~1500x) speedup for these repetitive elements.
**Action:** Use a bounded FIFO/LRU cache for deterministic, expensive utility functions (like tokenization) that process repetitive input in hot loops.
