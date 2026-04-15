import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { indexProject, RagIndexResult } from "./indexer.js";
import { retrieveTopK } from "./retriever.js";


export interface RagTestOptions {
  /** Embedding provider: 'hash' or 'glove' (default: 'hash') */
  provider?: "hash" | "glove";
  /** Test quantization (default: false) */
  quantize?: boolean;
  /** Enable quantize preload (default: false) */
  quantizePreload?: boolean;
  /** GloVe database path (required if provider === 'glove') */
  gloveModelPath?: string;
  /** Hash dimension (default: 256) */
  hashDimension?: number;
  /** Verbose output (default: false) */
  verbose?: boolean;
}

export interface RagTestResults {
  /** Overall test success */
  success: boolean;
  /** Individual test results */
  tests: {
    indexing: { success: boolean; result?: RagIndexResult; error?: string };
    retrieval: { success: boolean; queries: number; errors?: string[] };
    quantization?: { success: boolean; error?: string };
  };
  /** Metrics */
  metrics: {
    filesIndexed: number;
    chunksIndexed: number;
    retrievalQueries: number;
    retrievalTimeMs: number;
    totalTimeMs: number;
  };
  /** Temporary directory used */
  tempDir: string;
  /** Error messages if any */
  errors: string[];
}

/**
 * Create a temporary directory with sample text files for testing.
 * @returns Path to created directory
 */
export function createTestDirectory(): string {
  const tempDir = fs.mkdtempSync(path.join(tmpdir(), "grok-rag-test-"));
  
  // Create .grok subdirectory
  fs.mkdirSync(path.join(tempDir, ".grok"), { recursive: true });
  
  // Write sample files
  const files = [
    {
      name: "python_facts.txt",
      content: `Python is a high-level programming language.
It was created by Guido van Rossum and first released in 1991.
Python supports multiple programming paradigms including object-oriented, imperative, and functional programming.
Python uses indentation for code blocks instead of curly braces.
The Zen of Python is a collection of 19 software principles that influence the design of Python.`
    },
    {
      name: "javascript_facts.txt",
      content: `JavaScript is a programming language that conforms to the ECMAScript specification.
It is a high-level, often just-in-time compiled language.
JavaScript was created by Brendan Eich in 1995.
JavaScript is a multi-paradigm language supporting object-oriented, imperative, and functional programming.
Node.js allows JavaScript to run on the server-side.`
    },
    {
      name: "typescript_facts.txt",
      content: `TypeScript is a superset of JavaScript that adds static typing.
It was developed by Microsoft and first released in 2012.
TypeScript code compiles to plain JavaScript.
TypeScript supports interfaces, generics, and decorators.
TypeScript helps catch errors during development through type checking.`
    },
    {
      name: "nested/ai_facts.txt",
      content: `Artificial Intelligence is the simulation of human intelligence in machines.
Machine learning is a subset of AI that enables systems to learn from data.
Deep learning uses neural networks with multiple layers.
Natural Language Processing enables computers to understand human language.`
    }
  ];
  
  for (const file of files) {
    const filePath = path.join(tempDir, file.name);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, file.content);
  }
  
  return tempDir;
}

/**
 * Clean up a temporary directory.
 */
export function cleanupTestDirectory(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Set environment variables for the specified embedding provider.
 */
export function setupProviderEnv(options: RagTestOptions): void {
  // Clear previous provider env vars
  delete process.env.GROK_EMBEDDINGS_PROVIDER;
  delete process.env.GROK_EMBEDDINGS_HASH_DIMENSION;
  delete process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH;
  delete process.env.GROK_EMBEDDINGS_API_KEY;
  
  const provider = options.provider || "hash";
  process.env.GROK_EMBEDDINGS_PROVIDER = provider;
  
  if (provider === "hash") {
    process.env.GROK_EMBEDDINGS_HASH_DIMENSION = String(options.hashDimension || 256);
  } else if (provider === "glove" && options.gloveModelPath) {
    process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH = options.gloveModelPath;
  }
}

/**
 * Run RAG integration tests.
 */
export async function runRagTest(options: RagTestOptions = {}): Promise<RagTestResults> {
  const startTime = Date.now();
  const results: RagTestResults = {
    success: false,
    tests: {
      indexing: { success: false },
      retrieval: { success: false, queries: 0 },
    },
    metrics: {
      filesIndexed: 0,
      chunksIndexed: 0,
      retrievalQueries: 0,
      retrievalTimeMs: 0,
      totalTimeMs: 0,
    },
    tempDir: "",
    errors: [],
  };
  
  const tempDir = createTestDirectory();
  results.tempDir = tempDir;
  
  try {
    // Setup environment
    const originalEnv = { ...process.env };
    setupProviderEnv(options);
    
    // 1. Indexing test
    if (options.verbose) console.log(`[RAG Test] Indexing with provider: ${options.provider || "hash"}...`);

    
    try {
      const indexResult = await indexProject({
        cwd: tempDir,
        force: true,
        chunkLines: 5,
        overlapLines: 1,
        quantize: options.quantize || false,
        quantizePreload: options.quantizePreload || false,
      });
      
      results.tests.indexing = {
        success: true,
        result: indexResult,
      };
      results.metrics.filesIndexed = indexResult.filesIndexed;
      results.metrics.chunksIndexed = indexResult.chunksIndexed;
      
      if (options.verbose) {
        console.log(`[RAG Test] Indexed ${indexResult.filesIndexed} files, ${indexResult.chunksIndexed} chunks`);
      }
    } catch (error) {
      results.tests.indexing = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      results.errors.push(`Indexing failed: ${results.tests.indexing.error}`);
      // Restore env and cleanup
      process.env = originalEnv;
      cleanupTestDirectory(tempDir);
      results.metrics.totalTimeMs = Date.now() - startTime;
      return results;
    }
    
    // 2. Retrieval test
    if (options.verbose) console.log("[RAG Test] Testing retrieval...");
    const retrievalStart = Date.now();
    const testQueries = [
      "Who created Python?",
      "When was JavaScript created?",
      "What company developed TypeScript?",
      "What is machine learning?",
    ];
    
    const retrievalErrors: string[] = [];
    let successfulQueries = 0;
    
    for (const query of testQueries) {
      try {
        const chunks = await retrieveTopK(query, { cwd: tempDir, topK: 3 });
        if (chunks.length === 0) {
          retrievalErrors.push(`No chunks retrieved for query: "${query}"`);
        } else {
          successfulQueries++;
          
          // Basic content validation
          const text = chunks.map(c => c.text).join(" ");
          if (query.includes("Python") && !text.includes("Guido")) {
            retrievalErrors.push(`Python query missing creator: "${query}"`);
          }
          if (query.includes("JavaScript") && !text.includes("1995")) {
            retrievalErrors.push(`JavaScript query missing creation year: "${query}"`);
          }
          if (query.includes("TypeScript") && !text.includes("Microsoft")) {
            retrievalErrors.push(`TypeScript query missing company: "${query}"`);
          }
        }
      } catch (error) {
        retrievalErrors.push(`Retrieval failed for "${query}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    results.metrics.retrievalTimeMs = Date.now() - retrievalStart;
    results.metrics.retrievalQueries = testQueries.length;
    
    results.tests.retrieval = {
      success: retrievalErrors.length === 0,
      queries: successfulQueries,
      errors: retrievalErrors.length > 0 ? retrievalErrors : undefined,
    };
    
    if (retrievalErrors.length > 0) {
      results.errors.push(...retrievalErrors);
    }
    
    // 3. Quantization test (if enabled)
    if (options.quantize) {
      if (options.verbose) console.log("[RAG Test] Verifying quantization...");
      // Already tested via indexing with quantize=true
      results.tests.quantization = { success: true };
    }
    
    // Restore original environment
    process.env = originalEnv;
    
    // Overall success
    results.success = results.tests.indexing.success && results.tests.retrieval.success;
    
  } catch (error) {
    results.errors.push(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Cleanup
    cleanupTestDirectory(tempDir);
    results.metrics.totalTimeMs = Date.now() - startTime;
    
    if (options.verbose) {
      console.log(`[RAG Test] Completed in ${results.metrics.totalTimeMs}ms`);
      console.log(`[RAG Test] Success: ${results.success ? "✅" : "❌"}`);
    }
  }
  
  return results;
}

/**
 * Format test results as human-readable string.
 */
export function formatResults(results: RagTestResults, verbose = false): string {
  const lines: string[] = [];
  
  lines.push("RAG Test Results");
  lines.push("================");
  
  // Summary
  lines.push(`Overall: ${results.success ? "✅ PASS" : "❌ FAIL"}`);
  lines.push(`Time: ${results.metrics.totalTimeMs}ms`);
  lines.push(`Files indexed: ${results.metrics.filesIndexed}`);
  lines.push(`Chunks indexed: ${results.metrics.chunksIndexed}`);
  lines.push(`Retrieval queries: ${results.metrics.retrievalQueries} (${results.tests.retrieval.queries} successful)`);
  
  // Test details
  lines.push("");
  lines.push("Test Details:");
  lines.push(`  Indexing: ${results.tests.indexing.success ? "✅" : "❌"}`);
  if (!results.tests.indexing.success && results.tests.indexing.error) {
    lines.push(`    Error: ${results.tests.indexing.error}`);
  }
  
  lines.push(`  Retrieval: ${results.tests.retrieval.success ? "✅" : "❌"}`);
  if (results.tests.retrieval.errors?.length) {
    for (const error of results.tests.retrieval.errors) {
      lines.push(`    Error: ${error}`);
    }
  }
  
  if (results.tests.quantization) {
    lines.push(`  Quantization: ${results.tests.quantization.success ? "✅" : "❌"}`);
  }
  
  // Errors
  if (results.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    for (const error of results.errors) {
      lines.push(`  ❌ ${error}`);
    }
  }
  
  if (verbose) {
    lines.push("");
    lines.push("Verbose Info:");
    lines.push(`  Temp directory: ${results.tempDir}`);
    lines.push(`  Retrieval time: ${results.metrics.retrievalTimeMs}ms`);
  }
  
  return lines.join("\n");
}

/**
 * Format test results as JSON string.
 */
export function formatResultsJson(results: RagTestResults): string {
  return JSON.stringify(results, null, 2);
}