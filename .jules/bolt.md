## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Caching Tiktoken Encoders]
**Learning:** Initializing `Tiktoken` encoders (e.g., via `get_encoding` or `encoding_for_model`) is computationally expensive (~100ms per call) because it involves loading WASM and parsing BPE rank files. Caching these encoders globally for the lifetime of the process avoids this latency on subsequent calls. Since only a handful of encoding models (like `cl100k_base`) are typically used, the memory overhead is negligible.
**Action:** Always cache `Tiktoken` encoders globally instead of recreating them in short-lived objects or loops.
