export type KMedoidsDistance = "cosine" | "l2";

export interface KMedoidsOptions {
  maxIterations?: number;
}

/**
 * Select k medoids (indices) from the given vectors.
 * Returns indices into the input array.
 */
export function selectKMedoids(
  vectors: Float32Array[],
  k: number,
  distance: KMedoidsDistance = "cosine",
  options: KMedoidsOptions = {}
): number[] {
  const n = vectors.length;
  if (k <= 0 || n === 0) return [];
  if (k >= n) return [...Array(n).keys()];

  const maxIterations = options.maxIterations ?? 20;

  // Precompute pairwise distance matrix (symmetric).
  const D = computeDistanceMatrix(vectors, distance);

  // Init medoids via farthest-point sampling for diversity.
  let medoids = initFarthestPoint(D, k);

  // PAM swap refinement.
  for (let iter = 0; iter < maxIterations; iter++) {
    const currentCost = totalCost(D, medoids);
    let bestDelta = 0;
    let bestSwap: { m: number; h: number } | null = null;

    const medoidSet = new Set(medoids);
    for (const m of medoids) {
      for (let h = 0; h < n; h++) {
        if (medoidSet.has(h)) continue;
        const next = medoids.map((x) => (x === m ? h : x));
        const nextCost = totalCost(D, next);
        const delta = currentCost - nextCost;
        if (delta > bestDelta) {
          bestDelta = delta;
          bestSwap = { m, h };
        }
      }
    }

    if (!bestSwap) break;
    medoids = medoids.map((x) => (x === bestSwap.m ? bestSwap.h : x));
  }

  // Stable output order.
  return [...new Set(medoids)].sort((a, b) => a - b).slice(0, k);
}

function computeDistanceMatrix(
  vectors: Float32Array[],
  distance: KMedoidsDistance
): number[][] {
  const n = vectors.length;
  const D: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distance === "l2" ? l2Distance(vectors[i], vectors[j]) : cosineDistance(vectors[i], vectors[j]);
      D[i][j] = d;
      D[j][i] = d;
    }
  }
  return D;
}

function initFarthestPoint(D: number[][], k: number): number[] {
  const n = D.length;
  const medoids: number[] = [0];
  while (medoids.length < k) {
    let bestIdx = -1;
    let bestMinDist = -1;
    for (let i = 0; i < n; i++) {
      if (medoids.includes(i)) continue;
      let minD = Infinity;
      for (const m of medoids) minD = Math.min(minD, D[i][m]);
      if (minD > bestMinDist) {
        bestMinDist = minD;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    medoids.push(bestIdx);
  }
  return medoids.slice(0, k);
}

function totalCost(D: number[][], medoids: number[]): number {
  const n = D.length;
  let cost = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (const m of medoids) best = Math.min(best, D[i][m]);
    cost += best;
  }
  return cost;
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 1;
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  const cos = dot / denom;
  return 1 - Math.max(-1, Math.min(1, cos));
}

function l2Distance(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

