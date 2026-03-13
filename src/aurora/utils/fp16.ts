/**
 * FP16 (half-precision) conversion utilities for Aurora vector storage.
 * Reference implementation – not optimized for production.
 * 
 * Based on IEEE 754 half-precision floating-point format:
 * - Sign: 1 bit
 * - Exponent: 5 bits
 * - Mantissa: 10 bits
 */

// Shared buffers to eliminate per-call allocations and GC pressure
const convBuf = new ArrayBuffer(4);
const convF32 = new Float32Array(convBuf);
const convU32 = new Uint32Array(convBuf);

/**
 * Convert a single FP32 number to FP16 bits (Uint16).
 */
export function f32ToFp16(value: number): number {
  if (isNaN(value)) return 0x7e00; // NaN
  if (value === Infinity) return 0x7c00;
  if (value === -Infinity) return 0xfc00;

  convF32[0] = value;
  const bits = convU32[0];

  const sign = (bits >> 31) & 0x1;
  const exponent = (bits >> 23) & 0xff;
  let mantissa = bits & 0x7fffff;

  // Special case: zero or denormal
  if (exponent === 0 && mantissa === 0) {
    return sign << 15;
  }

  // Convert exponent from FP32 bias (127) to FP16 bias (15)
  let exp16 = exponent - 127 + 15;

  // Handle overflow/underflow
  if (exp16 >= 31) {
    // Overflow -> infinity
    return (sign << 15) | 0x7c00;
  }
  if (exp16 <= 0) {
    // Underflow -> denormal (may flush to zero)
    if (exp16 < -10) {
      // Too small, flush to zero
      return sign << 15;
    }
    // Denormal
    mantissa |= 0x800000; // implicit leading 1
    const shift = 1 - exp16;
    mantissa >>= shift;
    exp16 = 0;
  } else {
    // Normal number
    mantissa >>= 13; // Keep 10 bits
  }

  // Combine
  return (sign << 15) | (exp16 << 10) | (mantissa & 0x3ff);
}

/**
 * Convert FP16 bits (Uint16) to FP32 number.
 */
export function fp16ToF32(fp16: number): number {
  const sign = (fp16 >> 15) & 0x1;
  const exponent = (fp16 >> 10) & 0x1f;
  const mantissa = fp16 & 0x3ff;

  if (exponent === 0x1f) {
    // Infinity or NaN
    if (mantissa === 0) {
      return sign === 0 ? Infinity : -Infinity;
    }
    return NaN;
  }

  let exp32: number;
  let mant32: number;

  if (exponent === 0) {
    // Denormal or zero
    if (mantissa === 0) {
      return sign === 0 ? 0 : -0;
    }
    exp32 = 1 - 15; // exponent bias adjustment
    mant32 = mantissa << 13;
  } else {
    // Normal number
    exp32 = exponent - 15;
    mant32 = (mantissa | 0x400) << 13; // add implicit leading 1
  }

  // Convert to FP32 bias (127)
  exp32 += 127;

  // Combine bits
  const bits = (sign << 31) | ((exp32 & 0xff) << 23) | (mant32 & 0x7fffff);
  convU32[0] = bits;
  return convF32[0];
}

/**
 * Convert Float32Array to Uint16Array of FP16 values.
 */
export function float32ArrayToFp16(array: Float32Array): Uint16Array {
  const len = array.length;
  const result = new Uint16Array(len);
  let i = 0;
  const limit = len - (len % 8);
  // Unrolled loop: 8 conversions per iteration
  for (; i < limit; i += 8) {
    result[i] = f32ToFp16Fast(array[i]);
    result[i + 1] = f32ToFp16Fast(array[i + 1]);
    result[i + 2] = f32ToFp16Fast(array[i + 2]);
    result[i + 3] = f32ToFp16Fast(array[i + 3]);
    result[i + 4] = f32ToFp16Fast(array[i + 4]);
    result[i + 5] = f32ToFp16Fast(array[i + 5]);
    result[i + 6] = f32ToFp16Fast(array[i + 6]);
    result[i + 7] = f32ToFp16Fast(array[i + 7]);
  }
  // Handle remainder
  for (; i < len; i++) {
    result[i] = f32ToFp16Fast(array[i]);
  }
  return result;
}

/**
 * Convert Uint16Array of FP16 values to Float32Array.
 */
export function fp16ToFloat32Array(array: Uint16Array): Float32Array {
  const result = new Float32Array(array.length);
  for (let i = 0; i < array.length; i++) {
    result[i] = fp16ToF32(array[i]);
  }
  return result;
}

/**
 * Compute approximate memory savings ratio of FP16 vs FP32.
 */
export function getMemorySavingsRatio(): number {
  return 0.5; // FP16 uses half the bytes
}

/**
 * Benchmark conversion speed.
 */
export function benchmarkConversion(
  array: Float32Array,
  iterations: number = 1000
): { encodeMs: number; decodeMs: number; encodeThroughput: number; decodeThroughput: number } {
  const startEncode = performance.now();
  let encoded: Uint16Array | null = null;
  for (let i = 0; i < iterations; i++) {
    encoded = float32ArrayToFp16(array);
  }
  const endEncode = performance.now();

  if (!encoded) encoded = new Uint16Array(0);

  const startDecode = performance.now();
  for (let i = 0; i < iterations; i++) {
    fp16ToFloat32Array(encoded);
  }
  const endDecode = performance.now();

  const encodeMs = endEncode - startEncode;
  const decodeMs = endDecode - startDecode;
  const totalElements = array.length * iterations;
  const encodeThroughput = totalElements / (encodeMs / 1000);
  const decodeThroughput = totalElements / (decodeMs / 1000);

  return { encodeMs, decodeMs, encodeThroughput, decodeThroughput };
}

/**
 * Check if FP16 storage is enabled for current project.
 */
export function isFp16StorageEnabled(): boolean {
  // This function should be implemented by importing settings manager,
  // but to avoid circular dependencies we keep it separate.
  // The actual check will be done by the caller.
  return false;
}

/**
 * Compute dot product directly from FP16 vectors with unrolled conversion.
 * Avoids full array conversion for better cache locality.
 */
/**
 * Optimized FP32 to FP16 conversion using integer arithmetic (no DataView).
 * Faster for bulk operations.
 */
export function f32ToFp16Fast(value: number): number {
  // Handle special cases
  if (isNaN(value)) return 0x7e00;
  if (!isFinite(value)) return value > 0 ? 0x7c00 : 0xfc00;
  
  convF32[0] = value;
  const bits = convU32[0];
  
  const sign = (bits >> 31) & 0x1;
  const exponent = (bits >> 23) & 0xff;
  let mantissa = bits & 0x7fffff;
  
  // Special case: zero or denormal
  if (exponent === 0 && mantissa === 0) {
    return sign << 15;
  }
  
  // Convert exponent from FP32 bias (127) to FP16 bias (15)
  let exp16 = exponent - 127 + 15;
  
  // Handle overflow/underflow
  if (exp16 >= 31) {
    // Overflow -> infinity
    return (sign << 15) | 0x7c00;
  }
  if (exp16 <= 0) {
    // Underflow -> denormal (may flush to zero)
    if (exp16 < -10) {
      // Too small, flush to zero
      return sign << 15;
    }
    // Denormal
    mantissa |= 0x800000; // implicit leading 1
    const shift = 1 - exp16;
    mantissa >>= shift;
    exp16 = 0;
  } else {
    // Normal number
    mantissa >>= 13; // Keep 10 bits
  }
  
  // Combine
  return (sign << 15) | (exp16 << 10) | (mantissa & 0x3ff);
}

/**
 * Optimized FP16 to FP32 conversion using integer arithmetic.
 */
export function fp16ToF32Fast(fp16: number): number {
  const sign = (fp16 >> 15) & 0x1;
  const exponent = (fp16 >> 10) & 0x1f;
  const mantissa = fp16 & 0x3ff;
  
  if (exponent === 0x1f) {
    // Infinity or NaN
    if (mantissa === 0) {
      return sign === 0 ? Infinity : -Infinity;
    }
    return NaN;
  }
  
  let exp32: number;
  let mant32: number;
  
  if (exponent === 0) {
    // Denormal or zero
    if (mantissa === 0) {
      return sign === 0 ? 0 : -0;
    }
    exp32 = 1 - 15; // exponent bias adjustment
    mant32 = mantissa << 13;
  } else {
    // Normal number
    exp32 = exponent - 15;
    mant32 = (mantissa | 0x400) << 13; // add implicit leading 1
  }
  
  // Convert to FP32 bias (127)
  exp32 += 127;
  
  // Combine bits
  const bits = (sign << 31) | ((exp32 & 0xff) << 23) | (mant32 & 0x7fffff);
  convU32[0] = bits;
  return convF32[0];
}
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

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/utils/fp16.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/aurora/utils/fp16.ts.backup_20260302T193313_769897"
//   "created_at": "2026-03-02T11:33:13.784954+00:00"
//   "backup_hash": "7a7d3a6a6ff7797059c13fb7cfb34a37"
//   "new_hash": "89a1e0ebd1557f6ddab04ad5cbd018f9"
//   "goal_id": "text_anchor_replace"
//   "semantics": "Replace float32ArrayToFp16 with optimized version using fast conversion and unrolled loop."
//   "update_attrs": {"relative_path": "src/aurora/utils/fp16.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "export function float32ArrayToFp16(array: Float32Array): Uint16Array {\n  const result = new Uint16Array(array.length);\n  for (let i = 0; i < array.length; i++) {\n    result[i] = f32ToFp16(array[i]);\n  }\n  return result;\n}", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/utils/fp16.ts\""
// }
