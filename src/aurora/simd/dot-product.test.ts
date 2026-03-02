import { describe, it, expect } from 'vitest';
import {
  dotProductScalar,
  dotProductUnrolled4,
  dotProductUnrolled8,
  dotProduct,
  batchDotProduct,
  batchDotProductFlat,
} from './dot-product.js';

describe('dot-product', () => {
  const testVectors = [
    new Float32Array([1, 2, 3]),
    new Float32Array([4, 5, 6]),
    new Float32Array([-1, 0, 1]),
    new Float32Array([0, 0, 0]),
  ];

  it('dotProductScalar computes correct dot product', () => {
    const a = testVectors[0];
    const b = testVectors[1];
    expect(dotProductScalar(a, b)).toBe(1*4 + 2*5 + 3*6);
    expect(dotProductScalar(a, a)).toBe(1*1 + 2*2 + 3*3);
    expect(dotProductScalar(b, b)).toBe(4*4 + 5*5 + 6*6);
  });

  it('dotProductUnrolled4 matches scalar', () => {
    const a = testVectors[0];
    const b = testVectors[1];
    expect(dotProductUnrolled4(a, b)).toBe(dotProductScalar(a, b));
    expect(dotProductUnrolled4(a, a)).toBe(dotProductScalar(a, a));
  });

  it('dotProductUnrolled8 matches scalar', () => {
    const a = testVectors[0];
    const b = testVectors[1];
    expect(dotProductUnrolled8(a, b)).toBe(dotProductScalar(a, b));
    expect(dotProductUnrolled8(a, a)).toBe(dotProductScalar(a, a));
  });

  it('dotProduct chooses appropriate implementation', () => {
    const a = new Float32Array(10); // small dimension -> scalar
    const b = new Float32Array(10);
    // Just ensure it runs without error
    expect(() => dotProduct(a, b)).not.toThrow();
    
    const c = new Float32Array(20); // >=16 -> unrolled4
    const d = new Float32Array(20);
    expect(() => dotProduct(c, d)).not.toThrow();
    
    const e = new Float32Array(40); // >=32 -> unrolled8
    const f = new Float32Array(40);
    expect(() => dotProduct(e, f)).not.toThrow();
  });

  it('batchDotProduct computes scores for multiple vectors', () => {
    const target = new Float32Array([1, 0, 0]);
    const vectors = [
      new Float32Array([1, 0, 0]),
      new Float32Array([0, 1, 0]),
      new Float32Array([0, 0, 1]),
    ];
    const scores = new Array(vectors.length).fill(0);
    batchDotProduct(target, vectors, scores);
    expect(scores[0]).toBe(1);
    expect(scores[1]).toBe(0);
    expect(scores[2]).toBe(0);
  });

  it('batchDotProductFlat works with concatenated vectors', () => {
    const dim = 3;
    const target = new Float32Array([1, 2, 3]);
    const vectorsData = new Float32Array([
      1, 2, 3,    // vector 0
      4, 5, 6,    // vector 1
      7, 8, 9,    // vector 2
    ]);
    const scores = new Array(3).fill(0);
    batchDotProductFlat(target, vectorsData, dim, scores);
    expect(scores[0]).toBe(1*1 + 2*2 + 3*3);
    expect(scores[1]).toBe(1*4 + 2*5 + 3*6);
    expect(scores[2]).toBe(1*7 + 2*8 + 3*9);
  });

  it('throws on length mismatch', () => {
    const a = new Float32Array(5);
    const b = new Float32Array(6);
    expect(() => dotProductScalar(a, b)).toThrow(/length mismatch/);
    expect(() => dotProductUnrolled4(a, b)).toThrow(/length mismatch/);
    expect(() => dotProductUnrolled8(a, b)).toThrow(/length mismatch/);
  });

  it('batchDotProduct throws if scores array too small', () => {
    const target = new Float32Array([1, 2]);
    const vectors = [new Float32Array([3, 4])];
    const scores: number[] = [];
    expect(() => batchDotProduct(target, vectors, scores)).toThrow(/too small/);
  });

  it('batchDotProductFlat throws if vectorsData too small', () => {
    const target = new Float32Array([1, 2]);
    const vectorsData = new Float32Array([3, 4]); // only one vector
    const scores = [0, 0]; // expecting 2 vectors
    expect(() => batchDotProductFlat(target, vectorsData, 2, scores)).toThrow(/too small/);
  });
});