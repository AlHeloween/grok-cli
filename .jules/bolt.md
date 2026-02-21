# Bolt's Journal - Grok CLI

## 2025-05-14 - Initial Entry
**Learning:** Starting the optimization journey for Grok CLI.
**Action:** Explore the codebase for performance bottlenecks.

## 2025-05-14 - Optimized RAG Indexing Throughput
**Learning:** Sequential per-file embedding in RAG indexing causes many unnecessary API roundtrips, especially for projects with many small files. Batching embeddings across files and using database transactions significantly improves performance.
**Action:** Implemented global batching for embeddings and added transaction support to `VectorDb`. Reduced API calls from N (number of files) to ~TotalChunks/BatchSize.
