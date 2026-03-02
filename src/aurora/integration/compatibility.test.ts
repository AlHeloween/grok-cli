import { describe, expect, test } from 'vitest';
import { generateSierpinskiCentroids } from '../fractal/sierpinski.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Python-TypeScript compatibility', () => {
  test('Sierpinski centroids match Python reference', () => {
    // Load Python-generated centroids
    const jsonPath = path.join(process.cwd(), 'data', 'aurora_verification', 'sierpinski_centroids.json');
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const pyCentroids = data.centroids as number[][];
    const params = data.params as { n_dim: number; depth: number; seed: number; n_centroids: number };
    
    // Generate TypeScript centroids with same parameters
    const tsCentroids = generateSierpinskiCentroids({
      nDim: params.n_dim,
      depth: params.depth,
      maxCentroids: params.n_centroids,
      seed: params.seed,
    });
    
    expect(tsCentroids.length).toBe(pyCentroids.length);
    expect(tsCentroids[0].length).toBe(pyCentroids[0].length);
    
    // Compare each centroid with tolerance
    const tolerance = 1e-6;
    for (let i = 0; i < tsCentroids.length; i++) {
      for (let d = 0; d < tsCentroids[i].length; d++) {
        expect(tsCentroids[i][d]).toBeCloseTo(pyCentroids[i][d], tolerance);
      }
    }
  });
});