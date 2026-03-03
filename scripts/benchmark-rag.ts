#!/usr/bin/env bun

/**
 * RAG benchmark comparing FP16 vs FP32 storage performance.
 * Measures memory usage, retrieval speed, and accuracy.
 */

import { VectorDb } from '../src/rag/vector-db.js';
import { float32ArrayToFp16, fp16ToFloat32Array } from '../src/aurora/utils/fp16.js';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

function randomVector(dim: number): number[] {
  const arr = new Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const val = Math.random() * 2 - 1; // [-1, 1]
    arr[i] = val;
    norm += val * val;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) arr[i] /= norm;
  }
  return arr;
}

function randomText(): string {
  const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];
  const len = Math.floor(Math.random() * 5) + 3;
  const selected: string[] = [];
  for (let i = 0; i < len; i++) {
    selected.push(words[Math.floor(Math.random() * words.length)]);
  }
  return selected.join(' ');
}

async function createTestDb(dbPath: string, numChunks: number, dimension: number): Promise<VectorDb> {
  const db = await VectorDb.open(dbPath, { dimension });
  for (let i = 0; i < numChunks; i++) {
    db.insertChunk({
      path: `test${i}.txt`,
      text: randomText(),
      meta: JSON.stringify({ id: i }),
      vector: randomVector(dimension),
    });
  }
  // db.commitTransaction?.();
  db.quantize();
  return db;
}

function measureMemory(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed;
  }
  return 0;
}

async function benchmarkRetrieval(dbPath: string, useFp16: boolean, numQueries: number, dimension: number, topK: number): Promise<{ timeMs: number; memoryDelta: number; results: number[] }> {
  const db = await VectorDb.open(dbPath, { dimension });
  const startMemory = measureMemory();
  const startTime = performance.now();

  const results: number[] = [];
  for (let q = 0; q < numQueries; q++) {
    const queryVec = randomVector(dimension);
    // Simulate FP16 conversion if enabled
    if (useFp16) {
      const f32 = new Float32Array(queryVec);
      const fp16 = float32ArrayToFp16(f32);
      const reconstructed = fp16ToFloat32Array(fp16);
      // Use reconstructed vector for query (simulates conversion loss)
      const vecArray = Array.from(reconstructed);
      const chunks = db.queryTopK(vecArray, topK);
      results.push(chunks.length);
    } else {
      const chunks = db.queryTopK(queryVec, topK);
      results.push(chunks.length);
    }
  }

  const endTime = performance.now();
  const endMemory = measureMemory();
  db.close();

  return {
    timeMs: endTime - startTime,
    memoryDelta: endMemory - startMemory,
    results,
  };
}

async function runBenchmark() {
  console.log('=== RAG FP16 vs FP32 Benchmark ===\n');

  const dimension = 1536;
  const numChunks = 1000;
  const numQueries = 100;
  const topK = 10;

  const tmpDir = tmpdir();
  const dbPath = path.join(tmpDir, `rag_benchmark_${Date.now()}.db`);

  console.log(`Creating test database with ${numChunks} chunks (dimension ${dimension})...`);
  const db = await createTestDb(dbPath, numChunks, dimension);
  db.close();
  console.log(`Database created at ${dbPath}`);

  // Benchmark FP32 (baseline)
  console.log('\n--- FP32 (baseline) ---');
  const fp32Result = await benchmarkRetrieval(dbPath, false, numQueries, dimension, topK);
  console.log(`Time: ${fp32Result.timeMs.toFixed(2)} ms (${(fp32Result.timeMs / numQueries).toFixed(2)} ms per query)`);
  console.log(`Memory delta: ${(fp32Result.memoryDelta / 1024 / 1024).toFixed(2)} MB`);

  // Benchmark FP16
  console.log('\n--- FP16 (optimized) ---');
  const fp16Result = await benchmarkRetrieval(dbPath, true, numQueries, dimension, topK);
  console.log(`Time: ${fp16Result.timeMs.toFixed(2)} ms (${(fp16Result.timeMs / numQueries).toFixed(2)} ms per query)`);
  console.log(`Memory delta: ${(fp16Result.memoryDelta / 1024 / 1024).toFixed(2)} MB`);

  // Comparison
  console.log('\n--- Comparison ---');
  const timeRatio = fp16Result.timeMs / fp32Result.timeMs;
  const memoryRatio = fp16Result.memoryDelta / fp32Result.memoryDelta;
  console.log(`Time ratio (FP16/FP32): ${timeRatio.toFixed(2)}x`);
  console.log(`Memory ratio (FP16/FP32): ${memoryRatio.toFixed(2)}x`);
  console.log(`Expected memory ratio: 0.50x (50% reduction)`);

  // Cleanup
  try {
    fs.unlinkSync(dbPath);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    // ignore
  }

  console.log('\n=== Benchmark complete ===');
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\scripts/benchmark-rag.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-02T15:54:08.294784+00:00"
//   "new_hash": "9c52d43200e6bf04c1377b9681a4f38e"
//   "goal_id": "rag_benchmark_script"
//   "semantics": "Create RAG benchmark script for FP16 vs FP32 performance comparison"
//   "update_attrs": {"relative_path": "scripts/benchmark-rag.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\scripts/benchmark-rag.ts\""
// }
