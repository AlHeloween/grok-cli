#!/usr/bin/env bun

/**
 * Benchmark SIMD dot‑product implementations.
 */

import {
  dotProductScalar,
  dotProductUnrolled4,
  dotProductUnrolled8,
  benchmarkDotProduct,
} from '../src/aurora/simd/dot-product.js';

function randomVector(dim: number): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    arr[i] = Math.random() * 2 - 1; // [-1, 1]
  }
  // Normalize (optional)
  let norm = 0;
  for (const x of arr) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) arr[i] /= norm;
  }
  return arr;
}

function runBenchmark() {
  console.log('=== SIMD Dot‑Product Benchmark ===\n');

  const dimensions = [50, 100, 300]; // Typical GloVe dimensions
  const iterations = 10_000;

  for (const dim of dimensions) {
    console.log(`\nDimension ${dim}:`);
    
    // Generate test vectors
    const a = randomVector(dim);
    const b = randomVector(dim);
    const vectors = [a, b];

    // Warm‑up
    dotProductUnrolled8(a, b);
    dotProductUnrolled4(a, b);
    dotProductScalar(a, b);

    // Measure each implementation
    const implementations = [
      { name: 'Scalar', fn: dotProductScalar },
      { name: 'Unrolled 4', fn: dotProductUnrolled4 },
      { name: 'Unrolled 8', fn: dotProductUnrolled8 },
    ];

    for (const { name, fn } of implementations) {
      const start = performance.now();
      let sum = 0;
      for (let i = 0; i < iterations; i++) {
        sum += fn(a, b);
      }
      const end = performance.now();
      const time = end - start;
      const opsPerMs = iterations / time;
      console.log(`  ${name}: ${time.toFixed(2)} ms (${opsPerMs.toFixed(1)} ops/ms)`);
    }
  }

  // Benchmark using built‑in function
  console.log('\n=== Built‑in benchmarkDotProduct (pairwise) ===');
  const dim = 50;
  const vectors = Array.from({ length: 100 }, () => randomVector(dim));
  const results = benchmarkDotProduct(vectors, 1000);
  for (const [name, time] of Object.entries(results)) {
    console.log(`  ${name}: ${time.toFixed(2)} ms`);
  }
}

runBenchmark();