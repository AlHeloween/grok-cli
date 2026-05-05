## 2025-05-15 - [Batching RAG Embeddings Across Files]
**Learning:** In RAG systems, processing files one by one can lead to many small embedding API calls, which is inefficient due to network latency. Batching chunks across *multiple* files before calling the embedding API can significantly reduce the number of network roundtrips. Additionally, using transactions for SQLite (even in-memory ones that are persisted later) ensures atomicity and can slightly improve insertion throughput.
**Action:** Always look for opportunities to batch network-bound or IO-bound operations across logical boundaries (like files) when the API supports batch processing.

## 2026-05-05 - [Optimized Text Utilities]
**Learning:** Core text utility functions like `getTextPosition`, `moveToLineStart`, and `moveToLineEnd` were using `slice().split()` or `slice().indexOf()`, which causes unnecessary string allocations and array creations. Rewriting these to use native `indexOf` and `lastIndexOf` with the search start position argument avoids these allocations and provides a significant performance boost (~5x speedup for line counting on large files).
**Action:** Avoid string slicing before searching/splitting when native methods support a start position; always prefer iterative lookups over temporary array allocations for high-frequency utility functions.
