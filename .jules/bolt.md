## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Caching Tiktoken Encoders]
**Learning:** Initializing `tiktoken` encoders is computationally expensive (~80-100ms) because it involves loading and processing large BPE vocabularies (WASM overhead). In a CLI tool where `GrokAgent` (and thus `TokenCounter`) might be re-initialized, this latency becomes noticeable.
**Action:** Use a global static cache for `Tiktoken` encoders to ensure they are only initialized once per process.
