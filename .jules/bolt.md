## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-15 - [Tiktoken Encoder Caching]
**Learning:** Initializing a Tiktoken encoder is an expensive operation (approx. 100ms) due to WASM loading and vocabulary parsing. Repeatedly instantiating TokenCounter without caching leads to significant latency (e.g., ~5s for 50 instances).
**Action:** Use a global static cache for Tiktoken instances to ensure each encoding (like 'cl100k_base') is only loaded once per process lifetime. Make dispose() a no-op when sharing cached instances.
