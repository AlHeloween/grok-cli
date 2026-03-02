/**
 * Sierpinski N‑simplex fractal centroid generator (reference implementation).
 * Based on Aurora‑Genesis fractal/sierpinski.py (chaos‑game iteration).
 */

export interface SierpinskiOptions {
  /** Number of dimensions (N‑simplex has N+1 vertices) */
  nDim: number;
  /** Depth of chaos‑game iteration */
  depth: number;
  /** Random seed for deterministic generation */
  seed?: number;
  /** Maximum number of centroids to generate (if depth would produce too many) */
  maxCentroids?: number;
}

/**
 * Generate vertices of a regular N‑simplex centered at origin.
 */
function regularSimplexVertices(nDim: number): number[][] {
  if (nDim < 1) throw new Error(`nDim must be >= 1, got ${nDim}`);

  // Small dimensions: explicit formulas
  if (nDim === 1) {
    return [[-1.0], [1.0]];
  }
  if (nDim === 2) {
    const sqrt3 = Math.sqrt(3);
    return [
      [-1.0, -sqrt3 / 3],
      [1.0, -sqrt3 / 3],
      [0.0, 2 * sqrt3 / 3],
    ];
  }
  if (nDim === 3) {
    const sqrt3 = Math.sqrt(3);
    const sqrt6 = Math.sqrt(6);
    return [
      [-1.0, -1.0 / sqrt3, -1.0 / sqrt6],
      [1.0, -1.0 / sqrt3, -1.0 / sqrt6],
      [0.0, 2.0 / sqrt3, -1.0 / sqrt6],
      [0.0, 0.0, 3.0 / sqrt6],
    ];
  }

  // General case: generate using QR decomposition analogue
  const vertices: number[][] = [];
  for (let i = 0; i < nDim + 1; i++) {
    const vertex: number[] = new Array(nDim).fill(-1.0 / (nDim + 1));
    if (i === 0) {
      vertex[0] = 1.0;
    } else {
      vertex[i - 1] = 1.0 - (1.0 / (nDim + 1));
    }
    vertices.push(vertex);
  }

  // Normalize to unit sphere
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];
    const norm = Math.sqrt(vertex.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let j = 0; j < nDim; j++) {
        vertex[j] /= norm;
      }
    }
  }

  return vertices;
}

/**
 * Generate Sierpinski N‑simplex centroids using chaos‑game iteration.
 * Deterministic, based on LCG random sequence.
 */
export function generateSierpinskiCentroids(
  options: SierpinskiOptions
): number[][] {
  const { nDim, depth, seed = 1234, maxCentroids = 65536 } = options;

  if (nDim < 1) throw new Error(`nDim must be >= 1, got ${nDim}`);
  if (depth < 1) throw new Error(`depth must be >= 1, got ${depth}`);

  // Generate simplex vertices
  const vertices = regularSimplexVertices(nDim);
  const nVertices = vertices.length; // nDim + 1

  // Number of centroids: 2^(nDim * depth) is intractable for large values
  let nCentroidsTarget = 2 ** (nDim * depth);
  if (nCentroidsTarget > maxCentroids) {
    // Use depth=1 and generate maxCentroids instead (bounded runtime)
    nCentroidsTarget = maxCentroids;
  }

  const nCentroids = Math.min(nCentroidsTarget, maxCentroids);

  // LCG constants (matches Aurora CUDA header)
  const LCG_MULT = 1664525;
  const LCG_ADD = 1013904223;

  // Initialize centroids at origin
  const centroids: number[][] = Array.from({ length: nCentroids }, () => 
    new Array(nDim).fill(0)
  );

  // Initialize LCG states per centroid
  const states: number[] = Array.from({ length: nCentroids }, (_, idx) => {
    return ((seed & 0xFFFFFFFF) ^ ((idx * 747796405) & 0xFFFFFFFF)) & 0xFFFFFFFF;
  });

  // Chaos‑game iteration
  for (let iter = 0; iter < depth; iter++) {
    for (let c = 0; c < nCentroids; c++) {
      // Update LCG state
      states[c] = (((states[c] >>> 0) * LCG_MULT) + LCG_ADD) & 0xFFFFFFFF;
      // Choose random vertex
      const vertexIdx = (states[c] >>> 0) % nVertices;
      if (vertexIdx < 0 || vertexIdx >= vertices.length) throw new Error(`vertexIdx out of bounds: ${vertexIdx}, vertices length ${vertices.length}`);
      const vertex = vertices[vertexIdx];
      if (!vertex) throw new Error(`vertex is undefined at index ${vertexIdx}`);

      // Move to midpoint between current centroid and chosen vertex
      const centroid = centroids[c];
      for (let d = 0; d < nDim; d++) {
        centroid[d] = (centroid[d] + vertex[d]) * 0.5;
      }
    }
  }

  return centroids;
}

/**
 * Generate centroids and map them to a specific range (e.g., [-1, 1]^N).
 */
export function generateSierpinskiCentroidsNormalized(
  options: SierpinskiOptions,
  rangeMin: number = -1,
  rangeMax: number = 1
): number[][] {
  const centroids = generateSierpinskiCentroids(options);

  // Find bounding box
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const centroid of centroids) {
    for (const val of centroid) {
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }
  }

  // Normalize to range
  const scale = (rangeMax - rangeMin) / (maxVal - minVal);
  const offset = rangeMin - minVal * scale;

  return centroids.map(centroid => 
    centroid.map(val => val * scale + offset)
  );
}

/**
 * Utility: compute Euclidean distance between two vectors.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Find nearest centroid for a given vector.
 */
export function findNearestCentroid(
  vector: number[],
  centroids: number[][]
): { index: number; distance: number } {
  if (centroids.length === 0) throw new Error('centroids array is empty');
  if (vector.length !== centroids[0].length) throw new Error('vector dimension mismatch');
  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < centroids.length; i++) {
    if (centroids[i].length !== vector.length) throw new Error(`centroid ${i} dimension mismatch`);
    const dist = euclideanDistance(vector, centroids[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return { index: bestIdx, distance: bestDist };
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/fractal/sierpinski.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-01T14:37:42.424757+00:00"
//   "new_hash": "7425f8797db330ac370faed34e266dcd"
//   "goal_id": "create_src_aurora_fractal_sierpinski_ts"
//   "semantics": "Create src/aurora/fractal/sierpinski.ts (Aurora reference implementation)"
//   "update_attrs": {"relative_path": "src/aurora/fractal/sierpinski.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/fractal/sierpinski.ts\""
// }
