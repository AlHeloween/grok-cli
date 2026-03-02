import { describe, it, expect } from 'vitest';
import {
  generateSierpinskiCentroids,
  generateSierpinskiCentroidsNormalized,
  euclideanDistance,
  findNearestCentroid,
  type SierpinskiOptions,
} from './sierpinski.js';

describe('sierpinski', () => {
  describe('generateSierpinskiCentroids', () => {
    it('generates correct number of centroids for 2D depth 1', () => {
      const options: SierpinskiOptions = { nDim: 2, depth: 1 };
      const centroids = generateSierpinskiCentroids(options);
      // For 2D depth 1, formula 2^(nDim*depth) = 2^(2) = 4, but maxCentroids default 65536
      expect(centroids).toHaveLength(4);
      // Each centroid is array of length nDim
      centroids.forEach(c => expect(c).toHaveLength(2));
    });

    it('respects maxCentroids limit', () => {
      const options: SierpinskiOptions = { nDim: 2, depth: 3, maxCentroids: 5 };
      const centroids = generateSierpinskiCentroids(options);
      expect(centroids).toHaveLength(5);
    });

    it('is deterministic with seed', () => {
      const options1: SierpinskiOptions = { nDim: 3, depth: 2, seed: 42 };
      const options2: SierpinskiOptions = { nDim: 3, depth: 2, seed: 42 };
      const centroids1 = generateSierpinskiCentroids(options1);
      const centroids2 = generateSierpinskiCentroids(options2);
      expect(centroids1).toEqual(centroids2);
    });

    it('throws on invalid nDim', () => {
      expect(() => generateSierpinskiCentroids({ nDim: 0, depth: 1 }))
        .toThrow(/nDim must be >= 1/);
      expect(() => generateSierpinskiCentroids({ nDim: -1, depth: 1 }))
        .toThrow(/nDim must be >= 1/);
    });

    it('throws on invalid depth', () => {
      expect(() => generateSierpinskiCentroids({ nDim: 2, depth: 0 }))
        .toThrow(/depth must be >= 1/);
    });
  });

  describe('generateSierpinskiCentroidsNormalized', () => {
    it('normalizes to given range', () => {
      const options: SierpinskiOptions = { nDim: 2, depth: 1 };
      const centroids = generateSierpinskiCentroidsNormalized(options, 0, 10);
      centroids.forEach(c => {
        c.forEach(v => {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(10);
        });
      });
    });

    it('preserves shape', () => {
      const options: SierpinskiOptions = { nDim: 3, depth: 2 };
      const centroids = generateSierpinskiCentroidsNormalized(options);
      expect(centroids).toHaveLength(2 ** (3 * 2)); // 64
      centroids.forEach(c => expect(c).toHaveLength(3));
    });
  });

  describe('euclideanDistance', () => {
    it('computes distance correctly', () => {
      expect(euclideanDistance([0, 0], [3, 4])).toBe(5); // 3-4-5 triangle
      expect(euclideanDistance([1, 2, 3], [4, 5, 6])).toBeCloseTo(Math.sqrt(27));
      expect(euclideanDistance([0], [5])).toBe(5);
    });

    it('returns 0 for identical vectors', () => {
      const v = [1, 2, 3, 4];
      expect(euclideanDistance(v, v)).toBe(0);
    });

    it('throws on length mismatch', () => {
      expect(() => euclideanDistance([1, 2], [1])).toThrow();
    });
  });

  describe('findNearestCentroid', () => {
    const centroids = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];

    it('finds nearest centroid', () => {
      const query = [0.2, 0.2];
      const result = findNearestCentroid(query, centroids);
      expect(result.index).toBe(0); // closest to [0,0]
      expect(result.distance).toBeCloseTo(Math.sqrt(0.08));
    });

    it('handles exact match', () => {
      const query = [1, 0];
      const result = findNearestCentroid(query, centroids);
      expect(result.index).toBe(1);
      expect(result.distance).toBe(0);
    });

    it('handles empty centroids', () => {
      expect(() => findNearestCentroid([1, 2], [])).toThrow();
    });
  });
});