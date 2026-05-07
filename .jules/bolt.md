## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-03-05 - [Caching Tiktoken Encoders]
**Learning:** Tiktoken encoder initialization is expensive (~180ms per load) because it involves loading WASM and large vocabulary BPE ranks. In a CLI tool where `TokenCounter` may be instantiated multiple times, this latency is significant. Implementing a global static cache reduces subsequent instantiation time to <1ms, yielding a ~42x speedup for typical multi-instance scenarios.
**Action:** Always cache expensive third-party library initializations (especially WASM-based ones) at the module or static level when the objects are stateless and safe to share.
