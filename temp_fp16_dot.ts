/**
 * Compute dot product directly from FP16 vectors with unrolled conversion.
 * Avoids full array conversion for better cache locality.
 */
export function dotProductFp16Unrolled(aFp16: Uint16Array, bFp16: Uint16Array): number {
  const len = aFp16.length;
  if (len !== bFp16.length) {
    throw new Error(`Vector length mismatch: ${len} vs ${bFp16.length}`);
  }
  
  // Use unrolled loop for better performance
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
  
  // Process 8 elements at a time
  for (; i < limit; i += 8) {
    // Convert and multiply each pair
    const a0 = fp16ToF32(aFp16[i]);
    const b0 = fp16ToF32(bFp16[i]);
    sum0 += a0 * b0;
    
    const a1 = fp16ToF32(aFp16[i + 1]);
    const b1 = fp16ToF32(bFp16[i + 1]);
    sum1 += a1 * b1;
    
    const a2 = fp16ToF32(aFp16[i + 2]);
    const b2 = fp16ToF32(bFp16[i + 2]);
    sum2 += a2 * b2;
    
    const a3 = fp16ToF32(aFp16[i + 3]);
    const b3 = fp16ToF32(bFp16[i + 3]);
    sum3 += a3 * b3;
    
    const a4 = fp16ToF32(aFp16[i + 4]);
    const b4 = fp16ToF32(bFp16[i + 4]);
    sum4 += a4 * b4;
    
    const a5 = fp16ToF32(aFp16[i + 5]);
    const b5 = fp16ToF32(bFp16[i + 5]);
    sum5 += a5 * b5;
    
    const a6 = fp16ToF32(aFp16[i + 6]);
    const b6 = fp16ToF32(bFp16[i + 6]);
    sum6 += a6 * b6;
    
    const a7 = fp16ToF32(aFp16[i + 7]);
    const b7 = fp16ToF32(bFp16[i + 7]);
    sum7 += a7 * b7;
  }
  
  // Handle remainder
  for (; i < len; i++) {
    const a = fp16ToF32(aFp16[i]);
    const b = fp16ToF32(bFp16[i]);
    sum0 += a * b;
  }
  
  return sum0 + sum1 + sum2 + sum3 + sum4 + sum5 + sum6 + sum7;
}

/**
 * Batch dot product for FP16 vectors with target pre-converted to FP32.
 * More efficient when comparing one target against many candidates.
 */
export function batchDotProductFp16(
  targetFp16: Uint16Array,
  vectorsFp16: Uint16Array[],
  scores: number[]
): void {
  const n = vectorsFp16.length;
  if (scores.length < n) {
    throw new Error(`scores array too small: ${scores.length} < ${n}`);
  }
  
  const dim = targetFp16.length;
  
  // Convert target once to FP32
  const targetF32 = new Float32Array(dim);
  for (let d = 0; d < dim; d++) {
    targetF32[d] = fp16ToF32(targetFp16[d]);
  }
  
  // Compute dot products
  for (let i = 0; i < n; i++) {
    const vecFp16 = vectorsFp16[i];
    let sum = 0;
    for (let d = 0; d < dim; d++) {
      sum += targetF32[d] * fp16ToF32(vecFp16[d]);
    }
    scores[i] = sum;
  }
}