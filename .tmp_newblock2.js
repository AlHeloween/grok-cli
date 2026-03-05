      // Test retrieval with glove provider for each language
      const queries = [
        "Python programming",
        "JavaScript language",
        "TypeScript static typing",
        "Artificial intelligence",
      ];
      
      for (const query of queries) {
        const chunks = await retrieveTopK(query, { cwd: testProjectDir });
        expect(chunks.length).toBeGreaterThan(0);
      }
