## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2025-05-16 - [Caching Tokenizer Output]
**Learning:** Repeatedly tokenizing short, static strings like message roles ("user", "assistant", "system") or standard prefixes incurs a non-trivial performance cost because the tokenizer (often WASM-based) is called via a FFI boundary. A simple Map-based cache with a small memory footprint can yield orders of magnitude (e.g. 150x-200x) speedup for these repetitive calls.
**Action:** Use a FIFO-evicting cache for repetitive, deterministic computations that cross heavy boundaries like WASM or network, especially for short input payloads.
