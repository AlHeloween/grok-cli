import { describe, it, expect } from 'vitest';
import {
  f32ToFp16,
  fp16ToF32,
  float32ArrayToFp16,
  fp16ToFloat32Array,
  getMemorySavingsRatio,
  benchmarkConversion,
} from './fp16.js';

describe('FP16 conversion utilities', () => {
  describe('f32ToFp16', () => {
    it('converts zero', () => {
      expect(f32ToFp16(0)).toBe(0);
      expect(f32ToFp16(-0)).toBe(0x8000); // sign bit set
    });

    it('converts infinity', () => {
      expect(f32ToFp16(Infinity)).toBe(0x7c00);
      expect(f32ToFp16(-Infinity)).toBe(0xfc00);
    });

    it('converts NaN', () => {
      // NaN maps to a NaN representation (exponent all ones, mantissa non-zero)
      const result = f32ToFp16(NaN);
      expect(result).toBe(0x7e00); // Our implementation returns 0x7e00 for NaN
    });

    it('converts normal numbers', () => {
      // Test a few values
      expect(f32ToFp16(1.0)).toBe(0x3c00);
      expect(f32ToFp16(-1.0)).toBe(0xbc00);
      expect(f32ToFp16(2.0)).toBe(0x4000);
      expect(f32ToFp16(0.5)).toBe(0x3800);
    });

    it('handles denormal numbers', () => {
      // Very small numbers may become denormal or zero
      const tiny = 1.0e-7;
      const result = f32ToFp16(tiny);
      // Should be either zero or denormal
      expect(result === 0 || (result & 0x7c00) === 0).toBe(true);
    });
  });

  describe('fp16ToF32', () => {
    it('converts zero', () => {
      expect(fp16ToF32(0)).toBe(0);
      expect(fp16ToF32(0x8000)).toBe(-0);
    });

    it('converts infinity', () => {
      expect(fp16ToF32(0x7c00)).toBe(Infinity);
      expect(fp16ToF32(0xfc00)).toBe(-Infinity);
    });

    it('converts NaN', () => {
      expect(fp16ToF32(0x7e00)).toBeNaN();
    });

    it('converts normal numbers', () => {
      expect(fp16ToF32(0x3c00)).toBeCloseTo(1.0, 1e-4);
      expect(fp16ToF32(0xbc00)).toBeCloseTo(-1.0, 1e-4);
      expect(fp16ToF32(0x4000)).toBeCloseTo(2.0, 1e-4);
      expect(fp16ToF32(0x3800)).toBeCloseTo(0.5, 1e-4);
    });

    it('round-trip preserves precision within tolerance', () => {
      const testValues = [0, 1, -1, 2.5, -3.14, 100, 0.001];
      for (const val of testValues) {
        const fp16 = f32ToFp16(val);
        const back = fp16ToF32(fp16);
        // FP16 has about 3-4 decimal digits of precision
        expect(back).toBeCloseTo(val, 3);
      }
    });
  });

  describe('float32ArrayToFp16 and fp16ToFloat32Array', () => {
    it('converts arrays', () => {
      const arr = new Float32Array([1.0, 2.0, 3.0, -1.0]);
      const fp16 = float32ArrayToFp16(arr);
      expect(fp16).toBeInstanceOf(Uint16Array);
      expect(fp16.length).toBe(arr.length);

      const back = fp16ToFloat32Array(fp16);
      expect(back).toBeInstanceOf(Float32Array);
      expect(back.length).toBe(arr.length);
      for (let i = 0; i < arr.length; i++) {
        expect(back[i]).toBeCloseTo(arr[i], 3);
      }
    });

    it('handles empty array', () => {
      const arr = new Float32Array(0);
      const fp16 = float32ArrayToFp16(arr);
      expect(fp16.length).toBe(0);
      const back = fp16ToFloat32Array(fp16);
      expect(back.length).toBe(0);
    });
  });

  describe('getMemorySavingsRatio', () => {
    it('returns 0.5', () => {
      expect(getMemorySavingsRatio()).toBe(0.5);
    });
  });

  describe('benchmarkConversion', () => {
    it('runs without error', () => {
      const arr = new Float32Array(100);
      for (let i = 0; i < arr.length; i++) arr[i] = Math.random();
      const result = benchmarkConversion(arr, 10);
      expect(result).toHaveProperty('encodeMs');
      expect(result).toHaveProperty('decodeMs');
      expect(result).toHaveProperty('encodeThroughput');
      expect(result).toHaveProperty('decodeThroughput');
      expect(result.encodeMs).toBeGreaterThan(0);
      expect(result.decodeMs).toBeGreaterThan(0);
    });
  });
});

// ADID_ROLLBACK (from adm)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/utils/fp16.test.ts"
//   "update_script": "adm"
//   "backup_path": "none"
//   "created_at": "2026-03-02T07:47:22.511275+00:00"
//   "new_hash": "bb7e98f14258d68084deaa86e040c048"
//   "goal_id": "text_create_new_file"
//   "semantics": "Create FP16 conversion unit tests"
//   "update_attrs": {"relative_path": "src/aurora/utils/fp16.test.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/utils/fp16.test.ts\""
// }
