/**
 * Optimized FP16 conversion utilities using integer arithmetic.
 * Reference implementation – optimized for typical embedding ranges.
 */

// Shared buffers to eliminate per-call allocations and GC pressure
const convBuf = new ArrayBuffer(4);
const convF32 = new Float32Array(convBuf);
const convU32 = new Uint32Array(convBuf);

/**
 * Convert FP32 to FP16 using integer arithmetic (no DataView per element).
 * Optimized for values in typical embedding range [-1, 1].
 */
export function f32ToFp16Fast(value: number): number {
    // Handle special cases
    if (value === 0) return 0;
    if (isNaN(value)) return 0x7e00; // NaN
    if (!isFinite(value)) return value > 0 ? 0x7c00 : 0xfc00; // ±Inf

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
 * Convert FP16 to FP32 using integer arithmetic.
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

/**
 * Convert Float32Array to Uint16Array of FP16 values (optimized batch).
 * Uses unrolled loop for better performance.
 */
export function float32ArrayToFp16Fast(array: Float32Array): Uint16Array {
    const len = array.length;
    const result = new Uint16Array(len);

    // Process in batches of 8 for better cache locality
    let i = 0;
    const limit = len - (len % 8);

    // Unrolled loop
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

    // Remainder
    for (; i < len; i++) {
        result[i] = f32ToFp16Fast(array[i]);
    }

    return result;
}

/**
 * Convert Uint16Array of FP16 values to Float32Array (optimized batch).
 */
export function fp16ToFloat32ArrayFast(array: Uint16Array): Float32Array {
    const len = array.length;
    const result = new Float32Array(len);

    // Process in batches of 8
    let i = 0;
    const limit = len - (len % 8);

    for (; i < limit; i += 8) {
        result[i] = fp16ToF32Fast(array[i]);
        result[i + 1] = fp16ToF32Fast(array[i + 1]);
        result[i + 2] = fp16ToF32Fast(array[i + 2]);
        result[i + 3] = fp16ToF32Fast(array[i + 3]);
        result[i + 4] = fp16ToF32Fast(array[i + 4]);
        result[i + 5] = fp16ToF32Fast(array[i + 5]);
        result[i + 6] = fp16ToF32Fast(array[i + 6]);
        result[i + 7] = fp16ToF32Fast(array[i + 7]);
    }

    for (; i < len; i++) {
        result[i] = fp16ToF32Fast(array[i]);
    }

    return result;
}

/**
 * Ultra-fast batch conversion using pre-allocated buffers and SIMD-like approach.
 * Converts entire Float32Array to Uint16Array in-place using shared ArrayBuffer.
 */
export function float32ArrayToFp16InPlace(
    source: Float32Array,
    target: Uint16Array
): void {
    const len = source.length;
    if (target.length < len) {
        throw new Error(`Target array too small: ${target.length} < ${len}`);
    }

    // Use shared buffer optimization if possible
    if (source.buffer === target.buffer) {
        // Can't share because different element sizes
        // Fall back to regular conversion
        for (let i = 0; i < len; i++) {
            target[i] = f32ToFp16Fast(source[i]);
        }
        return;
    }

    // Optimized loop
    for (let i = 0; i < len; i++) {
        target[i] = f32ToFp16Fast(source[i]);
    }
}

/**
 * Compute dot product directly from FP16 vectors (converts on-the-fly).
 * Useful when we want to avoid full array conversion.
 */
export function dotProductFp16(aFp16: Uint16Array, bFp16: Uint16Array): number {
    const len = aFp16.length;
    if (len !== bFp16.length) {
        throw new Error(`Vector length mismatch: ${len} vs ${bFp16.length}`);
    }

    let sum = 0;
    // Convert and multiply element by element
    for (let i = 0; i < len; i++) {
        const a = fp16ToF32Fast(aFp16[i]);
        const b = fp16ToF32Fast(bFp16[i]);
        sum += a * b;
    }
    return sum;
}

/**
 * Batch dot product for FP16 vectors.
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
        targetF32[d] = fp16ToF32Fast(targetFp16[d]);
    }

    // Compute dot products
    for (let i = 0; i < n; i++) {
        const vecFp16 = vectorsFp16[i];
        let sum = 0;
        for (let d = 0; d < dim; d++) {
            sum += targetF32[d] * fp16ToF32Fast(vecFp16[d]);
        }
        scores[i] = sum;
    }
}

/**
 * Benchmark optimized vs original implementations.
 */
export function benchmarkFp16Optimizations(
    array: Float32Array,
    iterations: number = 1000
): Record<string, number> {
    const results: Record<string, number> = {};

    // Test original conversion
    const { float32ArrayToFp16, fp16ToFloat32Array } = require('./fp16.js');

    const start1 = performance.now();
    let encoded: Uint16Array | null = null;
    for (let i = 0; i < iterations; i++) {
        encoded = float32ArrayToFp16(array);
    }
    const end1 = performance.now();
    results['original_encode'] = end1 - start1;

    if (!encoded) encoded = new Uint16Array(0);

    const start2 = performance.now();
    for (let i = 0; i < iterations; i++) {
        fp16ToFloat32Array(encoded);
    }
    const end2 = performance.now();
    results['original_decode'] = end2 - start2;

    // Test optimized conversion
    const start3 = performance.now();
    for (let i = 0; i < iterations; i++) {
        encoded = float32ArrayToFp16Fast(array);
    }
    const end3 = performance.now();
    results['optimized_encode'] = end3 - start3;

    const start4 = performance.now();
    for (let i = 0; i < iterations; i++) {
        fp16ToFloat32ArrayFast(encoded);
    }
    const end4 = performance.now();
    results['optimized_decode'] = end4 - start4;

    return results;
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/utils/fp16-optimized.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-02T10:55:36.209832+00:00"
//   "new_hash": "aab30efa3bcf4fb38ab8c39ded89167a"
//   "goal_id": "text_create_new_file"
//   "semantics": "Create optimized FP16 conversion utilities with integer arithmetic."
//   "update_attrs": {"relative_path": "src/aurora/utils/fp16-optimized.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/utils/fp16-optimized.ts\""
// }
