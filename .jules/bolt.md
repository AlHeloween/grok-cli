## 2025-05-14 - [RAG Indexing Optimization]
**Learning:** Embedding API calls are the primary bottleneck in RAG indexing. Projects with many small files suffer from high network roundtrip overhead if batching is only done per-file. Cross-file batching significantly reduces total API calls. Additionally, even in-memory SQLite performance benefits from grouping insertions into transactions.
**Action:** Always look for opportunities to batch network-bound operations across iterations of a loop. In SQLite-based RAG systems, ensure that bulk insertions are wrapped in transactions.
