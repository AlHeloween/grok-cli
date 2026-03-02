/**
 * Aurora RAG integration wrapper.
 * 
 * This module wraps the existing RAG retrieval with Aurora concepts:
 * - Fractal centroid quantization (Sierpinski N‑simplex)
 * - FFE (Fractal Feature Encoding) lattice addressing
 * - Dual‑quaternion geodesic distance for k‑medoids
 * - GloVe keyword extraction for cluster summarization
 * 
 * Reference implementation only – not production‑ready.
 */

import { retrieveTopK, type RagRetrieveOptions } from '../../rag/retriever.js';
import { type RagChunkRow } from '../../rag/vector-db.js';
import { createEmbeddingClientFromSettings as _createEmbeddingClientFromSettings } from '../../rag/embedding-client.js';
import { VectorDb } from '../../rag/vector-db.js';
import { selectKMedoids, type KMedoidsDistance } from '../../rag/k-medoids.js';
import { getSettingsManager } from '../../utils/settings-manager.js';

import { generateSierpinskiCentroids, findNearestCentroid } from '../fractal/sierpinski.js';
import { vectorToDualQuaternion, dualQuatGeodesicDistance as _dualQuatGeodesicDistance, dualQuatGeodesicDistanceMatrix } from '../dual-complex/dual-quaternion.js';
import { ffeQuantize, ffeAddressToString } from '../memory/ffe-quantization.js';
import { latticeAddressFromFfe, latticeAddressToString } from '../memory/lattice-addressing.js';
import { extractClusterKeywordsWithGlove } from '../../rag/semantic-vector.js';

export interface AuroraRagOptions extends RagRetrieveOptions {
  /** Enable Aurora fractal centroid quantization (default: false) */
  useFractalQuantization?: boolean;
  /** Enable dual‑quaternion geodesic distance (default: false) */
  useDualQuaternionDistance?: boolean;
  /** Enable GloVe keyword extraction for cluster summarization (default: false) */
  useGloveKeywords?: boolean;
  /** Fractal dimension for Sierpinski centroids (default: 8) */
  fractalDimension?: number;
  /** Fractal depth for centroid generation (default: 3) */
  fractalDepth?: number;
  /** Weight for rotation component in dual‑quaternion distance (default: 1.0) */
  dualQuatRotationWeight?: number;
  /** Weight for translation component in dual‑quaternion distance (default: 1.0) */
  dualQuatTranslationWeight?: number;
}

/**
 * Wrapper around retrieveTopK that adds Aurora enhancements.
 */
export async function auroraRetrieveTopK(
  queryText: string,
  options: AuroraRagOptions = {}
): Promise<RagChunkRow[]> {
  const cwd = options.cwd || process.cwd();
  const settings = getSettingsManager();
  const dbPath = settings.getRagDbPath(cwd);

  // Fall back to standard retrieveTopK if no Aurora features enabled
  if (!options.useFractalQuantization && !options.useDualQuaternionDistance && !options.useGloveKeywords) {
    return retrieveTopK(queryText, options);
  }

  // 1. Standard retrieval to get candidates
  const baseOptions: RagRetrieveOptions = {
    cwd: options.cwd,
    topK: options.topK,
    useKMedoids: false, // We'll apply our own clustering
    candidateCount: options.candidateCount,
    searchChatFirst: options.searchChatFirst,
    chatPrefix: options.chatPrefix,
  };

  const candidates = await retrieveTopK(queryText, baseOptions);
  const k = options.topK ?? settings.getRagTopK(cwd);
  if (candidates.length <= k) {
    return candidates;
  }

  // 2. Get vector database and fetch vectors for candidates
  const db = await VectorDb.open(dbPath);
  const ids = candidates.map((c) => Number(c.id)).filter((x) => Number.isFinite(x) && x > 0);
  const idToVec = db.getChunkVectorsByIds(ids);

  // Build arrays of vectors and rows
  const vectors: Float32Array[] = [];
  const rows: RagChunkRow[] = [];
  for (const c of candidates) {
    const id = Number(c.id);
    const vec = idToVec.get(id);
    if (!vec) continue;
    vectors.push(vec);
    rows.push(c);
  }

  if (vectors.length <= k) {
    return rows;
  }

  // 3. Apply fractal quantization if enabled
  if (options.useFractalQuantization) {
    const dim = options.fractalDimension ?? 8;
    const depth = options.fractalDepth ?? 3;
    
    // Generate Sierpinski centroids (deterministic)
    const centroids = generateSierpinskiCentroids({
      nDim: dim,
      depth,
      seed: 42,
    });

    // Map each vector to its nearest centroid (simple quantization)
    const quantizedVectors = vectors.map(vec => {
      // Project high-dimensional vector to fractal dimension if needed
      let projected: number[];
      if (vec.length > dim) {
        // Simple truncation for reference implementation
        projected = Array.from(vec.subarray(0, dim));
      } else if (vec.length < dim) {
        // Pad with zeros
        projected = Array.from(vec);
        while (projected.length < dim) projected.push(0);
      } else {
        projected = Array.from(vec);
      }
      
      const { index } = findNearestCentroid(projected, centroids);
      // Use centroid coordinates as quantized representation
      return new Float32Array(centroids[index]);
    });

    // Replace vectors with quantized versions for distance computation
    // (For now, we just store them; could use for distance)
    // For simplicity, we'll use the quantized vectors if dual-quaternion distance is enabled
    if (options.useDualQuaternionDistance) {
      // Convert quantized vectors to dual quaternions
      const dualQuats = quantizedVectors.map(vec => vectorToDualQuaternion(vec));
      
      // Use dual-quaternion geodesic distance matrix
      const wRot = options.dualQuatRotationWeight ?? 1.0;
      const wTrans = options.dualQuatTranslationWeight ?? 1.0;
      const D = dualQuatGeodesicDistanceMatrix(dualQuats, wRot, wTrans);
      
      // Run k-medoids with custom distance matrix
      const medoidIdx = selectKMedoidsWithDistanceMatrix(D, k);
      const selected = medoidIdx.map((i) => rows[i]).filter(Boolean);
      
      // 4. Apply GloVe keyword extraction if enabled
      if (options.useGloveKeywords && selected.length > 0) {
        await addGloveKeywordsToChunks(selected);
      }
      
      return selected;
    }
  }

  // 4. Standard k-medoids with optional dual-quaternion distance
  let distanceMetric: KMedoidsDistance = 'cosine';
  if (options.useDualQuaternionDistance) {
    // Check if vectors are already 8D (dual quaternions)
    const is8D = vectors.every(v => v.length === 8);
    if (is8D) {
      distanceMetric = 'dual-quaternion-geodesic';
    } else {
      // Convert to dual quaternions via simple projection
      const dualQuats = vectors.map(vec => vectorToDualQuaternion(vec));
      // Use dual-quaternion geodesic distance matrix
      const wRot = options.dualQuatRotationWeight ?? 1.0;
      const wTrans = options.dualQuatTranslationWeight ?? 1.0;
      const D = dualQuatGeodesicDistanceMatrix(dualQuats, wRot, wTrans);
      const medoidIdx = selectKMedoidsWithDistanceMatrix(D, k);
      const selected = medoidIdx.map((i) => rows[i]).filter(Boolean);
      
      if (options.useGloveKeywords && selected.length > 0) {
        await addGloveKeywordsToChunks(selected);
      }
      
      return selected;
    }
  } else {
    // Use DB's distance metric
    const metric = db.getDistanceMetric();
    distanceMetric = metric === "L2" || metric === "SQUARED_L2" ? "l2" : "cosine";
  }

  // Standard k-medoids selection
  const medoidIdx = selectKMedoids(vectors, k, distanceMetric);
  const selected = medoidIdx.map((i) => rows[i]).filter(Boolean);

  // 5. Apply GloVe keyword extraction if enabled
  if (options.useGloveKeywords && selected.length > 0) {
    await addGloveKeywordsToChunks(selected);
  }

  return selected;
}

/**
 * Select k medoids using a precomputed distance matrix.
 */
function selectKMedoidsWithDistanceMatrix(
  D: number[][],
  k: number,
  maxIterations: number = 20
): number[] {
  const n = D.length;
  if (k <= 0 || n === 0) return [];
  if (k >= n) return [...Array(n).keys()];

  // Initialize medoids via farthest-point sampling
  let medoids: number[] = [0];
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

  // PAM swap refinement
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

  return [...new Set(medoids)].sort((a, b) => a - b).slice(0, k);
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

/**
 * Add GloVe keywords to chunk metadata.
 */
async function addGloveKeywordsToChunks(chunks: RagChunkRow[]): Promise<void> {
  try {
    const texts = chunks.map(c => c.text);
    // Each text is its own cluster for simplicity
    const clusterLabels = texts.map((_, i) => i);
    const keywordsList = await extractClusterKeywordsWithGlove(texts, clusterLabels, 3);
    
    chunks.forEach((chunk, i) => {
      const keywords = keywordsList.get(i);
      if (keywords && keywords.length > 0) {
        // Add keywords to metadata (append to existing meta)
        const meta = chunk.meta ? JSON.parse(chunk.meta) : {};
        meta.glove_keywords = keywords;
        chunk.meta = JSON.stringify(meta);
      }
    });
  } catch (error) {
    // Silently fail for reference implementation
    console.debug('[AuroraRAG] GloVe keyword extraction failed:', error);
  }
}

/**
 * Generate FFE lattice addresses for a set of vectors.
 * Returns array of address strings.
 */
export function generateFfeLatticeAddresses(
  vectors: Float32Array[],
  nLevels: number = 3,
  nPerLevel: number = 9
): string[] {
  const addresses: string[] = [];
  
  for (const vec of vectors) {
    // Convert to dual quaternion (simplified)
    const dq = vectorToDualQuaternion(vec);
    // FFE quantization
    const ffeBits = ffeQuantize(Array.from(dq), nLevels, nPerLevel);
    const ffeAddr = ffeAddressToString(ffeBits);
    // Lattice addressing
    const latticeAddr = latticeAddressFromFfe(ffeBits, nLevels, nPerLevel);
    const latticeStr = latticeAddressToString(latticeAddr);
    
    addresses.push(`${ffeAddr}|${latticeStr}`);
  }
  
  return addresses;
}
