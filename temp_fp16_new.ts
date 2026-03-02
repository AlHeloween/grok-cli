/**
 * FP16 (half-precision) conversion utilities for Aurora vector storage.
 * Reference implementation – not optimized for production.
 * 
 * Based on IEEE 754 half-precision floating-point format:
 * - Sign: 1 bit
 * - Exponent: 5 bits
 * - Mantissa: 10 bits
 */

/**
 * Convert a single FP32 number to FP16 bits (Uint16).
 */
export function f32ToFp16(value: number): number {
  if (isNaN(value)) return 0x7e00; // NaN
  if (value === Infinity) return 0x7c00;
  if (value === -Infinity) return 0xfc00;

  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setFloat32(0, value, true); // little-endian
  const bits = view.getUint32(0, true);

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
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint32(0, bits, true);
  return view.getFloat32(0, true);
}

/**
 * Convert Float32Array to Uint16Array of FP16 values.
 */
export function float32ArrayToFp16(array: Float32Array): Uint16Array {
  const result = new Uint16Array(array.length);
  for (let i = 0; i < array.length; i++) {
    result[i] = f32ToFp16(array[i]);
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

// ADID_ROLLBACK (from adm)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/utils/fp16.ts"
//   "update_script": "adm"
//   "backup_path": "none"
//   "created_at": "2026-03-02T07:44:11.217138+00:00"
//   "new_hash": "af99d503f83264ed7f5cad63cc2f6ad2"
//   "goal_id": "text_create_new_file"
//   "semantics": "Create FP16 conversion utilities for Aurora vector storage"
//   "update_attrs": {"relative_path": "src/aurora/utils/fp16.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/utils/fp16.ts\""
// }
