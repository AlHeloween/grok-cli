## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Caching Tiktoken Encoders]
**Learning:** Initializing `Tiktoken` encoders (e.g., `cl100k_base`) is computationally expensive (~100ms) because it involves loading and parsing large BPE rank files into WASM memory. In CLI tools where `TokenCounter` might be instantiated multiple times (e.g., per message or per tool call), this overhead quickly accumulates.
**Action:** Use a static cache (e.g., a `Map`) for `Tiktoken` encoders and make `dispose()` a no-op to persist them for the process lifetime. This reduces instantiation time to <4ms (~25x speedup).
