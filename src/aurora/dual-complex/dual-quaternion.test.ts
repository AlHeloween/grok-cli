import { describe, it, expect } from 'vitest';
import {
  quatConjugate,
  quatMultiply,
  extractTranslationDualQuat,
  dualQuatGeodesicDistance,
  dualQuatGeodesicDistanceMatrix,
  vectorToDualQuaternion,
} from './dual-quaternion.js';

describe('dual-quaternion', () => {
  describe('quatConjugate', () => {
    it('conjugates a quaternion', () => {
      const q = new Float32Array([1, 2, 3, 4]); // w, x, y, z
      const conj = quatConjugate(q);
      expect(conj[0]).toBe(1); // w unchanged
      expect(conj[1]).toBe(-2);
      expect(conj[2]).toBe(-3);
      expect(conj[3]).toBe(-4);
    });
  });

  describe('quatMultiply', () => {
    it('multiplies two quaternions', () => {
      // Identity * Identity = Identity
      const q1 = new Float32Array([1, 0, 0, 0]);
      const q2 = new Float32Array([1, 0, 0, 0]);
      const prod = quatMultiply(q1, q2);
      expect(prod[0]).toBeCloseTo(1);
      expect(prod[1]).toBeCloseTo(0);
      expect(prod[2]).toBeCloseTo(0);
      expect(prod[3]).toBeCloseTo(0);
    });

    it('multiplies non‑trivial quaternions', () => {
      // Example from Wikipedia: i * j = k
      const i = new Float32Array([0, 1, 0, 0]);
      const j = new Float32Array([0, 0, 1, 0]);
      const k = quatMultiply(i, j);
      expect(k[0]).toBeCloseTo(0); // w
      expect(k[1]).toBeCloseTo(0); // x
      expect(k[2]).toBeCloseTo(0); // y
      expect(k[3]).toBeCloseTo(1); // z (k)
    });
  });

  describe('extractTranslationDualQuat', () => {
    it('extracts translation from pure translation dual quaternion', () => {
      // Real part: identity rotation (1,0,0,0)
      // Dual part: pure translation (0, tx/2, ty/2, tz/2)
      const tx = 1.0, ty = 2.0, tz = 3.0;
      const dq = new Float32Array([1, 0, 0, 0, 0, tx/2, ty/2, tz/2]);
      const translation = extractTranslationDualQuat(dq);
      expect(translation[0]).toBeCloseTo(tx);
      expect(translation[1]).toBeCloseTo(ty);
      expect(translation[2]).toBeCloseTo(tz);
    });

    it('handles zero translation', () => {
      const dq = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);
      const translation = extractTranslationDualQuat(dq);
      expect(translation[0]).toBeCloseTo(0);
      expect(translation[1]).toBeCloseTo(0);
      expect(translation[2]).toBeCloseTo(0);
    });
  });

  describe('dualQuatGeodesicDistance', () => {
    it('distance between identical dual quaternions is zero', () => {
      const dq = new Float32Array([1, 0, 0, 0, 0, 0.5, 0.5, 0.5]);
      const dist = dualQuatGeodesicDistance(dq, dq);
      expect(dist).toBeCloseTo(0, 6);
    });

    it('distance between pure translations', () => {
      const dq1 = new Float32Array([1, 0, 0, 0, 0, 0.5, 0, 0]); // tx = 1
      const dq2 = new Float32Array([1, 0, 0, 0, 0, 1.0, 0, 0]); // tx = 2
      const dist = dualQuatGeodesicDistance(dq1, dq2, 1.0, 1.0);
      // Translation distance = 1, rotation distance = 0
      expect(dist).toBeCloseTo(1.0, 6);
    });

    it('throws on invalid length', () => {
      const dq1 = new Float32Array(7); // length 7
      const dq2 = new Float32Array(8);
      expect(() => dualQuatGeodesicDistance(dq1, dq2)).toThrow(/length=8/);
    });
  });

  describe('dualQuatGeodesicDistanceMatrix', () => {
    it('computes symmetric distance matrix', () => {
      const dqs = [
        new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]),
        new Float32Array([1, 0, 0, 0, 0, 0.5, 0, 0]),
        new Float32Array([1, 0, 0, 0, 0, 1.0, 0, 0]),
      ];
      const D = dualQuatGeodesicDistanceMatrix(dqs);
      expect(D).toHaveLength(3);
      expect(D[0]).toHaveLength(3);
      // Diagonal should be zero
      for (let i = 0; i < 3; i++) {
        expect(D[i][i]).toBeCloseTo(0, 6);
      }
      // Symmetry
      expect(D[0][1]).toBeCloseTo(D[1][0], 6);
      expect(D[0][2]).toBeCloseTo(D[2][0], 6);
      expect(D[1][2]).toBeCloseTo(D[2][1], 6);
    });
  });

  describe('vectorToDualQuaternion', () => {
    it('converts 8D vector', () => {
      const vec = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const dq = vectorToDualQuaternion(vec);
      expect(dq).toHaveLength(8);
      for (let i = 0; i < 8; i++) {
        expect(dq[i]).toBe(vec[i]);
      }
    });

    it('pads short vectors with zeros', () => {
      const vec = new Float32Array([1, 2, 3]);
      const dq = vectorToDualQuaternion(vec);
      expect(dq).toHaveLength(8);
      expect(dq[0]).toBe(1);
      expect(dq[1]).toBe(2);
      expect(dq[2]).toBe(3);
      for (let i = 3; i < 8; i++) {
        expect(dq[i]).toBe(0);
      }
      // Real part should be non-zero (small epsilon added)
      expect(dq[0]).not.toBe(0);
    });

    it('adds epsilon to zero real part', () => {
      const vec = new Float32Array(8); // all zeros
      const dq = vectorToDualQuaternion(vec);
      expect(dq[0]).toBeCloseTo(1e-6, 10);
      for (let i = 1; i < 8; i++) {
        expect(dq[i]).toBe(0);
      }
    });
  });
});

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/dual-complex/dual-quaternion.test.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-01T23:44:58.661019+00:00"
//   "new_hash": "002c943144da253d493bfcf6c5274cc6"
//   "goal_id": "text_create_new_file"
//   "semantics": "Create unit test for dual-quaternion module."
//   "update_attrs": {"relative_path": "src/aurora/dual-complex/dual-quaternion.test.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/dual-complex/dual-quaternion.test.ts\""
// }
