import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { indexProject } from "./indexer.js";
import { retrieveTopK } from "./retriever.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Local embeddings integration", () => {
  const testProjectDir = path.join(__dirname, "../../.tmp/test-local-embeddings");
  
  beforeEach(async () => {
    // Clean up and create test directory
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testProjectDir, { recursive: true });
    fs.mkdirSync(path.join(testProjectDir, ".grok"), { recursive: true });
    
    // Write a simple test file
    fs.writeFileSync(path.join(testProjectDir, "test.txt"), `This is a test file.
It contains some text that can be embedded.
We will use hash embeddings for this test.`);
    
    // Set environment variables to use hash provider
    process.env.GROK_EMBEDDINGS_PROVIDER = "hash";
    process.env.GROK_EMBEDDINGS_HASH_DIMENSION = "128";
    // Ensure no API key required
    delete process.env.GROK_EMBEDDINGS_API_KEY;
  });
  
  afterEach(() => {
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
    delete process.env.GROK_EMBEDDINGS_PROVIDER;
    delete process.env.GROK_EMBEDDINGS_HASH_DIMENSION;
  });
  
  it("should index and retrieve using hash embeddings", async () => {
    const result = await indexProject({
      cwd: testProjectDir,
      force: true,
      chunkLines: 10,
      overlapLines: 2,
      quantize: true,
    });
    
    expect(result.filesIndexed).toBe(1);
    expect(result.chunksIndexed).toBeGreaterThan(0);
    
    // Retrieve with a query
    const chunks = await retrieveTopK("test query", { cwd: testProjectDir });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text).toContain("test");
  }, 30000);
  
  it("should work with glove provider if database exists", async () => {
    // Skip if test glove database not present
    const gloveDbPath = path.join(__dirname, "../../data/glove/test.db");
    if (!fs.existsSync(gloveDbPath)) {
      console.warn("Skipping glove provider test: test.db not found");
      return;
    }
    
    process.env.GROK_EMBEDDINGS_PROVIDER = "glove";
    process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH = gloveDbPath;
    
    const result = await indexProject({
      cwd: testProjectDir,
      force: true,
      chunkLines: 10,
      overlapLines: 2,
      quantize: true,
    });
    
    expect(result.filesIndexed).toBe(1);
    expect(result.chunksIndexed).toBeGreaterThan(0);
  }, 30000);
});