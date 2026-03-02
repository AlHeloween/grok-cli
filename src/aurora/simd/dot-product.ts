/**
 * SIMD‑accelerated dot‑product utilities for Aurora reference implementation.
 * 
 * Provides scalar, unrolled, and (future) WebAssembly SIMD implementations
 * for computing cosine similarity between GloVe vectors.
 * 
 * All vectors are assumed to be normalized (unit length).
 */

/**
 * Scalar dot product (baseline).
 */
export function dotProductScalar(a: Float32Array, b: Float32Array): number {
  const len = a.length;
  if (len !== b.length) {
    throw new Error(`Vector length mismatch: ${len} vs ${b.length}`);
  }
  
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Unrolled dot product (8‑way unrolling).
 * Gives better performance on modern JS engines.
 */
export function dotProductUnrolled8(a: Float32Array, b: Float32Array): number {
  const len = a.length;
  if (len !== b.length) {
    throw new Error(`Vector length mismatch: ${len} vs ${b.length}`);
  }
  
  let sum0 = 0;
  let sum1 = 0;
  let sum2 = 0;
  let sum3 = 0;
  let sum4 = 0;
  let sum5 = 0;
  let sum6 = 0;
  let sum7 = 0;
  
  let i = 0;
  const limit = len - (len % 8);
  
  // Unrolled loop: 8 multiplications per iteration
  for (; i < limit; i += 8) {
    sum0 += a[i] * b[i];
    sum1 += a[i + 1] * b[i + 1];
    sum2 += a[i + 2] * b[i + 2];
    sum3 += a[i + 3] * b[i + 3];
    sum4 += a[i + 4] * b[i + 4];
    sum5 += a[i + 5] * b[i + 5];
    sum6 += a[i + 6] * b[i + 6];
    sum7 += a[i + 7] * b[i + 7];
  }
  
  // Handle remainder
  for (; i < len; i++) {
    sum0 += a[i] * b[i];
  }
  
  return sum0 + sum1 + sum2 + sum3 + sum4 + sum5 + sum6 + sum7;
}

/**
 * Unrolled dot product (4‑way unrolling).
 * Useful when dimension is not a multiple of 8.
 */
export function dotProductUnrolled4(a: Float32Array, b: Float32Array): number {
  const len = a.length;
  if (len !== b.length) {
    throw new Error(`Vector length mismatch: ${len} vs ${b.length}`);
  }
  
  let sum0 = 0;
  let sum1 = 0;
  let sum2 = 0;
  let sum3 = 0;
  
  let i = 0;
  const limit = len - (len % 4);
  
  for (; i < limit; i += 4) {
    sum0 += a[i] * b[i];
    sum1 += a[i + 1] * b[i + 1];
    sum2 += a[i + 2] * b[i + 2];
    sum3 += a[i + 3] * b[i + 3];
  }
  
  for (; i < len; i++) {
    sum0 += a[i] * b[i];
  }
  
  return sum0 + sum1 + sum2 + sum3;
}

/**
 * Best available dot‑product implementation.
 * Chooses between scalar, unrolled, or (future) WASM SIMD.
 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  // For now, use unrolled 8 if dimension is large enough
  const len = a.length;
  if (len >= 32) {
    return dotProductUnrolled8(a, b);
  } else if (len >= 16) {
    return dotProductUnrolled4(a, b);
  }
  return dotProductScalar(a, b);
}

/**
 * Batch dot‑product: compute similarity between a target vector and multiple vectors.
 * Results are written into the `scores` array (must be pre‑allocated).
 * 
 * @param target Target vector (Float32Array)
 * @param vectors Array of vectors (Float32Array[])
 * @param scores Output array (number[])
 */
export function batchDotProduct(
  target: Float32Array,
  vectors: Float32Array[],
  scores: number[]
): void {
  const n = vectors.length;
  if (scores.length < n) {
    throw new Error(`scores array too small: ${scores.length} < ${n}`);
  }
  
  // Choose implementation based on dimension
  const dim = target.length;
  let fn: (a: Float32Array, b: Float32Array) => number;
  if (dim >= 32) {
    fn = dotProductUnrolled8;
  } else if (dim >= 16) {
    fn = dotProductUnrolled4;
  } else {
    fn = dotProductScalar;
  }
  
  for (let i = 0; i < n; i++) {
    scores[i] = fn(target, vectors[i]);
  }
}

/**
 * Batch dot‑product with pre‑deserialized vectors stored in a single Float32Array.
 * Each vector is stored consecutively in `vectorsData`.
 * 
 * @param target Target vector (Float32Array)
 * @param vectorsData Concatenated vectors (Float32Array of length n * dim)
 * @param dim Dimension of each vector
 * @param scores Output array (number[])
 */
export function batchDotProductFlat(
  target: Float32Array,
  vectorsData: Float32Array,
  dim: number,
  scores: number[]
): void {
  const n = scores.length;
  const totalLength = n * dim;
  if (vectorsData.length < totalLength) {
    throw new Error(`vectorsData too small: ${vectorsData.length} < ${totalLength}`);
  }
  
  // Use scalar loop for simplicity (can be optimized later)
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const offset = i * dim;
    for (let d = 0; d < dim; d++) {
      sum += target[d] * vectorsData[offset + d];
    }
    scores[i] = sum;
  }
}

/**
 * Check if WebAssembly SIMD is available (future extension).
 */
export function isSimdAvailable(): boolean {
  // @ts-expect-error WebAssembly.SIMD may not be defined in all environments
  return typeof WebAssembly !== 'undefined' && WebAssembly.SIMD !== undefined;
}

/**
 * Performance benchmark: compare implementations.
 * Returns object with timings (ms) per implementation.
 */
export function benchmarkDotProduct(
  vectors: Float32Array[],
  iterations: number = 1000
): Record<string, number> {
  if (vectors.length < 2) return {};
  
  const a = vectors[0];
  const b = vectors[1];
  const results: Record<string, number> = {};
  
  const implementations = [
    { name: 'scalar', fn: dotProductScalar },
    { name: 'unrolled4', fn: dotProductUnrolled4 },
    { name: 'unrolled8', fn: dotProductUnrolled8 },
  ];
  
  for (const { name, fn } of implementations) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      fn(a, b);
    }
    const end = performance.now();
    results[name] = end - start;
  }
  
  return results;
}