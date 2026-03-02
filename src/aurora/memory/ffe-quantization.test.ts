import { describe, it, expect } from 'vitest';
import {
  FFEQuantizer,
  addressToBits,
  bitsToAddress,
  ffeQuantize,
  ffeAddressToString,
  ffeAddressToStringFromAddr,
  type FFEAddress,
} from './ffe-quantization.js';

describe('ffe-quantization', () => {
  describe('addressToBits / bitsToAddress', () => {
    it('round-trip conversion', () => {
      const addr: FFEAddress = { level: 3, index: 127, subIndex: 2 };
      const bits = addressToBits(addr);
      expect(bits).toBeGreaterThanOrEqual(0);
      expect(bits).toBeLessThan(2 ** 14); // 14-bit max
      const decoded = bitsToAddress(bits);
      expect(decoded).toEqual(addr);
    });

    it('handles max values', () => {
      const addr: FFEAddress = { level: 7, index: 511, subIndex: 3 };
      const bits = addressToBits(addr);
      expect(bits).toBe((7 << 11) | (511 << 2) | 3);
      expect(bitsToAddress(bits)).toEqual(addr);
    });

    it('masks out-of-range bits correctly', () => {
      // addressToBits does not validate; bitsToAddress extracts bits with masking.
      const bits = (8 << 11) | (512 << 2) | 4; // out of range bits
      const addr = bitsToAddress(bits);
      // Bits are masked by 3/9/2 bits
      expect(addr.level).toBe(1); // 8 contributes to bit 11 (level bit 0)
      expect(addr.index).toBe(1); // 512 contributes to bit 11 (index bit 0)
      expect(addr.subIndex).toBe(0); // 4 -> 0 (2 bits)
    });
  });

  describe('FFEQuantizer', () => {
    it('initializes with default options', () => {
      const quantizer = new FFEQuantizer({});
      expect(quantizer.nLevels).toBe(8);
      expect(quantizer.nPerLevel).toBe(512);
      expect(quantizer.dim).toBe(8);
    });

    it('respects custom options', () => {
      const quantizer = new FFEQuantizer({
        nLevels: 3,
        nPerLevel: 9,
        dim: 4,
        seed: 42,
      });
      expect(quantizer.nLevels).toBe(3);
      expect(quantizer.nPerLevel).toBe(9);
      expect(quantizer.dim).toBe(4);
    });

    it('throws on invalid options', () => {
      expect(() => new FFEQuantizer({ nLevels: 9 })).toThrow(/nLevels must be <= 8/);
      expect(() => new FFEQuantizer({ nPerLevel: 513 })).toThrow(/nPerLevel must be <= 512/);
    });

    it('quantizes a vector', () => {
      const quantizer = new FFEQuantizer({ nLevels: 2, nPerLevel: 5, dim: 2 });
      const vector = [0.5, -0.5];
      const bits = quantizer.quantize(vector, false) as number;
      expect(typeof bits).toBe('number');
      expect(bits).toBeGreaterThanOrEqual(0);
      expect(bits).toBeLessThan(2 ** 14);
    });

    it('quantizes with metadata', () => {
      const quantizer = new FFEQuantizer({ nLevels: 2, nPerLevel: 5, dim: 2 });
      const vector = [0.5, -0.5];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [bits, meta] = quantizer.quantize(vector, true) as [number, any];
      expect(bits).toBeDefined();
      expect(meta.exactPosition).toEqual(vector);
      expect(meta.quantizationError).toBeGreaterThanOrEqual(0);
      expect(meta.address).toHaveProperty('level');
      expect(meta.address).toHaveProperty('index');
      expect(meta.address).toHaveProperty('subIndex');
    });

    it('dequantizes address back to centroid', () => {
      const quantizer = new FFEQuantizer({ nLevels: 2, nPerLevel: 5, dim: 2 });
      const vector = [0.5, -0.5];
      const bits = quantizer.quantize(vector, false) as number;
      const centroid = quantizer.dequantize(bits);
      expect(centroid).toHaveLength(2);
      // centroid should be one of the precomputed centroids
      const centroidsLevel0 = quantizer.getCentroids(0);
      const centroidsLevel1 = quantizer.getCentroids(1);
      const allCentroids = [...centroidsLevel0, ...centroidsLevel1];
      const found = allCentroids.some(c => c[0] === centroid[0] && c[1] === centroid[1]);
      expect(found).toBe(true);
    });

    it('quantizeBatch returns array of addresses', () => {
      const quantizer = new FFEQuantizer({ nLevels: 2, nPerLevel: 5, dim: 2 });
      const vectors = [[0.5, -0.5], [0.1, 0.2], [-0.3, 0.4]];
      const addresses = quantizer.quantizeBatch(vectors, false) as number[];
      expect(addresses).toHaveLength(3);
      addresses.forEach(addr => {
        expect(typeof addr).toBe('number');
        expect(addr).toBeGreaterThanOrEqual(0);
      });
    });

    it('quantizeBatch with metadata', () => {
      const quantizer = new FFEQuantizer({ nLevels: 2, nPerLevel: 5, dim: 2 });
      const vectors = [[0.5, -0.5], [0.1, 0.2]];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [addresses, metadata] = quantizer.quantizeBatch(vectors, true) as [number[], any[]];
      expect(addresses).toHaveLength(2);
      expect(metadata).toHaveLength(2);
      metadata.forEach(meta => {
        expect(meta).toHaveProperty('quantizationError');
      });
    });

    it('computes quantization error statistics', () => {
      const quantizer = new FFEQuantizer({ nLevels: 2, nPerLevel: 5, dim: 2 });
      const vectors = [[0.5, -0.5], [0.1, 0.2], [-0.3, 0.4]];
      const stats = quantizer.computeQuantizationError(vectors);
      expect(stats.meanError).toBeGreaterThanOrEqual(0);
      expect(stats.maxError).toBeGreaterThanOrEqual(stats.meanError);
      expect(stats.minError).toBeLessThanOrEqual(stats.maxError);
    });
  });

  describe('ffeQuantize', () => {
    it('simplified quantization works', () => {
      const vector = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
      const bits = ffeQuantize(vector, 3, 9);
      expect(typeof bits).toBe('number');
      expect(bits).toBeGreaterThanOrEqual(0);
    });

    it('throws on dimension mismatch', () => {
      const quantizer = new FFEQuantizer({ dim: 8 });
      const vector = [1, 2, 3]; // length 3
      expect(() => quantizer.quantize(vector, false)).toThrow(/dimension mismatch/);
    });
  });

  describe('ffeAddressToString', () => {
    it('formats address bits', () => {
      const addr: FFEAddress = { level: 2, index: 123, subIndex: 1 };
      const bits = addressToBits(addr);
      const str = ffeAddressToString(bits);
      expect(str).toBe('L2.123.1');
    });

    it('formats address object', () => {
      const addr: FFEAddress = { level: 5, index: 7, subIndex: 3 };
      const str = ffeAddressToStringFromAddr(addr);
      expect(str).toBe('L5.7.3');
    });
  });
});