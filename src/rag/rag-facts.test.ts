import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { indexProject } from "./indexer.js";
import { retrieveTopK } from "./retriever.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("RAG facts integration test", () => {
  const testProjectDir = path.join(__dirname, "../../.tmp/test_rag_facts");
  
  beforeEach(async () => {
    // Clean up and create test directory
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testProjectDir, { recursive: true });
    fs.mkdirSync(path.join(testProjectDir, ".grok"), { recursive: true });
    
    // Write fact files
    fs.writeFileSync(path.join(testProjectDir, "python_facts.txt"), `Python is a high-level programming language.
It was created by Guido van Rossum and first released in 1991.
Python supports multiple programming paradigms including object-oriented, imperative, and functional programming.
Python uses indentation for code blocks instead of curly braces.
The Zen of Python is a collection of 19 software principles that influence the design of Python.`);

    fs.writeFileSync(path.join(testProjectDir, "javascript_facts.txt"), `JavaScript is a programming language that conforms to the ECMAScript specification.
It is a high-level, often just-in-time compiled language.
JavaScript was created by Brendan Eich in 1995.
JavaScript is a multi-paradigm language supporting object-oriented, imperative, and functional programming.
Node.js allows JavaScript to run on the server-side.`);

    fs.writeFileSync(path.join(testProjectDir, "typescript_facts.txt"), `TypeScript is a superset of JavaScript that adds static typing.
It was developed by Microsoft and first released in 2012.
TypeScript code compiles to plain JavaScript.
TypeScript supports interfaces, generics, and decorators.
TypeScript helps catch errors during development through type checking.`);

    // Also create a nested file to test directory traversal
    const nestedDir = path.join(testProjectDir, "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, "ai_facts.txt"), `Artificial Intelligence is the simulation of human intelligence in machines.
Machine learning is a subset of AI that enables systems to learn from data.
Deep learning uses neural networks with multiple layers.
Natural Language Processing enables computers to understand human language.`);
    
    // Set environment variables to use hash provider (no API needed)
    process.env.GROK_EMBEDDINGS_PROVIDER = "hash";
    process.env.GROK_EMBEDDINGS_HASH_DIMENSION = "256";
    delete process.env.GROK_EMBEDDINGS_API_KEY;
  });
  
  afterEach(() => {
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
    delete process.env.GROK_EMBEDDINGS_PROVIDER;
    delete process.env.GROK_EMBEDDINGS_HASH_DIMENSION;
  });
  
  it("should index fact files and retrieve relevant information", async () => {
    // Index the facts
    const result = await indexProject({
      cwd: testProjectDir,
      force: true,
      chunkLines: 5,
      overlapLines: 1,
      quantize: false, // Disable quantization for simpler test
    });
    
    expect(result.filesIndexed).toBe(4); // python, javascript, typescript, ai_facts
    expect(result.chunksIndexed).toBeGreaterThan(0);
    
    // Test queries for each language
    const pythonQuery = "Who created Python?";
    const pythonChunks = await retrieveTopK(pythonQuery, { cwd: testProjectDir });
    expect(pythonChunks.length).toBeGreaterThan(0);
    // At least one chunk should mention Guido van Rossum
    const pythonText = pythonChunks.map(c => c.text).join(" ");
    expect(pythonText).toMatch(/Guido van Rossum/i);
    
    const javascriptQuery = "When was JavaScript created?";
    const jsChunks = await retrieveTopK(javascriptQuery, { cwd: testProjectDir });
    expect(jsChunks.length).toBeGreaterThan(0);
    const jsText = jsChunks.map(c => c.text).join(" ");
    expect(jsText).toMatch(/1995/i);
    
    const typescriptQuery = "What company developed TypeScript?";
    const tsChunks = await retrieveTopK(typescriptQuery, { cwd: testProjectDir });
    expect(tsChunks.length).toBeGreaterThan(0);
    const tsText = tsChunks.map(c => c.text).join(" ");
    expect(tsText).toMatch(/Microsoft/i);
    
    const aiQuery = "What is machine learning?";
    const aiChunks = await retrieveTopK(aiQuery, { cwd: testProjectDir });
    expect(aiChunks.length).toBeGreaterThan(0);
    const aiText = aiChunks.map(c => c.text).join(" ");
    expect(aiText).toMatch(/subset of AI|learn from data/i);
  }, 30000);
  
  it("should work with different embedding providers", async () => {
    // Test with hash provider (already set in beforeEach)
    const hashResult = await indexProject({
      cwd: testProjectDir,
      force: true,
      chunkLines: 5,
      overlapLines: 1,
    });
    
    expect(hashResult.filesIndexed).toBe(4);
    expect(hashResult.chunksIndexed).toBeGreaterThan(0);
    
    // Query should work
    const chunks = await retrieveTopK("Python programming", { cwd: testProjectDir });
    expect(chunks.length).toBeGreaterThan(0);
    
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
    }
  }, 30000);
  
  it("should respect quantization settings when enabled", async () => {
    // Test with quantization enabled
    const quantizedResult = await indexProject({
      cwd: testProjectDir,
      force: true,
      chunkLines: 5,
      overlapLines: 1,
      quantize: true,
      quantizePreload: false,
    });
    
    expect(quantizedResult.filesIndexed).toBe(4);
    expect(quantizedResult.chunksIndexed).toBeGreaterThan(0);
    
    // Query should still work with quantized vectors
    const chunks = await retrieveTopK("TypeScript typing", { cwd: testProjectDir });
    expect(chunks.length).toBeGreaterThan(0);
    
    // Test that we can also index without quantization
    const nonQuantizedResult = await indexProject({
      cwd: testProjectDir,
      force: true,
      chunkLines: 5,
      overlapLines: 1,
      quantize: false,
    });
    
    expect(nonQuantizedResult.filesIndexed).toBe(4);
    expect(nonQuantizedResult.chunksIndexed).toBeGreaterThan(0);
  }, 30000);
});