    // Test with glove provider if test database exists
    const gloveDbPath = path.join(__dirname, "../../data/glove/test.db");
    if (fs.existsSync(gloveDbPath)) {
      process.env.GROK_EMBEDDINGS_PROVIDER = "glove";
      process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH = gloveDbPath;
      
      // Need to force re-index with glove provider
      const gloveResult = await indexProject({
        cwd: testProjectDir,
        force: true,
        chunkLines: 5,
        overlapLines: 1,
      });
      
      expect(gloveResult.filesIndexed).toBe(4);
      expect(gloveResult.chunksIndexed).toBeGreaterThan(0);
      
      // Semantic retrieval test: query for each language should return its own facts as top result
      const queries = [
        { query: "Python programming", expectedPath: "python_facts.txt" },
        { query: "JavaScript language", expectedPath: "javascript_facts.txt" },
        { query: "TypeScript static typing", expectedPath: "typescript_facts.txt" },
        { query: "Artificial intelligence", expectedPath: "nested/ai_facts.txt" },
      ];
      
      for (const { query, expectedPath } of queries) {
        const chunks = await retrieveTopK(query, { cwd: testProjectDir });
        expect(chunks.length).toBeGreaterThan(0);
        // The top chunk should be from the expected file (semantic relevance)
        const topChunk = chunks[0];
        expect(topChunk.path).toContain(expectedPath);
      }
    }
