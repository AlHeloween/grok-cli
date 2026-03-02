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
import { float32ArrayToFp16, fp16ToFloat32Array } from '../utils/fp16.js';

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
  /** Enable FP16 storage for vectors (reduces memory, adds conversion overhead) (default: false) */
  useFp16Storage?: boolean;
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

  // Read Aurora settings if not explicitly overridden
  const auroraEnabled = settings.getRagAuroraEnabled(cwd);
  let useFractalQuantization = options.useFractalQuantization ?? settings.getRagAuroraFractalQuantization(cwd);
  let useDualQuaternionDistance = options.useDualQuaternionDistance ?? settings.getRagAuroraDualQuaternionDistance(cwd);
  let useGloveKeywords = options.useGloveKeywords ?? settings.getRagAuroraGloveKeywords(cwd);
  let useFp16Storage = options.useFp16Storage ?? settings.getRagAuroraUseFp16Storage(cwd);
  
  // Master toggle overrides all
  if (!auroraEnabled) {
    useFractalQuantization = false;
    useDualQuaternionDistance = false;
    useGloveKeywords = false;
    useFp16Storage = false;
  }
  
  // Fall back to standard retrieveTopK if no Aurora features enabled
  if (!useFractalQuantization && !useDualQuaternionDistance && !useGloveKeywords && !useFp16Storage) {
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
// Build arrays of vectors and rows
let vectors: Float32Array[] = [];
const rows: RagChunkRow[] = [];
for (const c of candidates) {
  const id = Number(c.id);
  const vec = idToVec.get(id);
  if (!vec) continue;
  vectors.push(vec);
  rows.push(c);
}

const vectorCount = vectors.length;

// Convert vectors to FP16 storage if enabled
let fp16Vectors: Uint16Array[] | null = null;
if (useFp16Storage && vectorCount > 0) {
  fp16Vectors = vectors.map(vec => float32ArrayToFp16(vec));
  // Clear vectors to save memory (they can be reconstructed from FP16)
  vectors = [];
}

if (vectorCount <= k) {
  return rows;
}

// Helper to get vectors (convert from FP16 if needed)
const getVectors = (): Float32Array[] => {
  if (useFp16Storage && fp16Vectors && fp16Vectors.length > 0) {
    return fp16Vectors.map(fp16 => fp16ToFloat32Array(fp16));
  }
  return vectors;
};

  // 3. Apply fractal quantization if enabled
  if (useFractalQuantization) {
    const dim = options.fractalDimension ?? 8;
    const depth = options.fractalDepth ?? 3;
    
    // Generate Sierpinski centroids (deterministic)
    const centroids = generateSierpinskiCentroids({
      nDim: dim,
      depth,
      seed: 42,
    });

    // Get vectors (converted from FP16 if needed)
    const currentVectors = getVectors();

    // Map each vector to its nearest centroid (simple quantization)
    const quantizedVectors = currentVectors.map(vec => {
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
    if (useDualQuaternionDistance) {
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
      if (useGloveKeywords && selected.length > 0) {
        await addGloveKeywordsToChunks(selected);
      }
      
      return selected;
    }
  }

  // 4. Standard k-medoids with optional dual-quaternion distance
let distanceMetric: KMedoidsDistance = 'cosine';
if (useDualQuaternionDistance) {
  // Get vectors (converted from FP16 if needed)
  const currentVectors = getVectors();

  // Check if vectors are already 8D (dual quaternions)
  const is8D = currentVectors.every(v => v.length === 8);
    if (is8D) {
      distanceMetric = 'dual-quaternion-geodesic';
    } else {
      // Convert to dual quaternions via simple projection
      const dualQuats = currentVectors.map(vec => vectorToDualQuaternion(vec));
      // Use dual-quaternion geodesic distance matrix
      const wRot = options.dualQuatRotationWeight ?? 1.0;
      const wTrans = options.dualQuatTranslationWeight ?? 1.0;
      const D = dualQuatGeodesicDistanceMatrix(dualQuats, wRot, wTrans);
      const medoidIdx = selectKMedoidsWithDistanceMatrix(D, k);
      const selected = medoidIdx.map((i) => rows[i]).filter(Boolean);
      
      if (useGloveKeywords && selected.length > 0) {
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
const currentVectors = getVectors();
const medoidIdx = selectKMedoids(currentVectors, k, distanceMetric);
  const selected = medoidIdx.map((i) => rows[i]).filter(Boolean);

  // 5. Apply GloVe keyword extraction if enabled
  if (useGloveKeywords && selected.length > 0) {
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

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/integration/rag-wrapper.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/aurora/integration/rag-wrapper.ts.backup_20260302T194938_799539"
//   "created_at": "2026-03-02T11:49:38.815477+00:00"
//   "backup_hash": "32fa37a0a11635329c910ec5934212a3"
//   "new_hash": "48384d632f4385429aba3ce9e659f98c"
//   "goal_id": "memory_clearing"
//   "semantics": "Replace vectors block with memory clearing optimization."
//   "update_attrs": {"relative_path": "src/aurora/integration/rag-wrapper.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "const vectors: Float32Array[] = [];\nconst rows: RagChunkRow[] = [];\nfor (const c of candidates) {\n  const id = Number(c.id);\n  const vec = idToVec.get(id);\n  if (!vec) continue;\n  vectors.push(vec);\n  rows.push(c);\n}\n\n// Convert vectors to FP16 storage if enabled\nlet fp16Vectors: Uint16Array[] | null = null;\nif (useFp16Storage && vectors.length > 0) {\n  fp16Vectors = vectors.map(vec => float32ArrayToFp16(vec));\n  // Clear vectors to save memory (they can be reconstructed from FP16)\n  // vectors = []; // Keep vectors for now to avoid rewriting logic\n}\n\nif (vectors.length <= k) {\n  return rows;\n}\n\n// Helper to get vectors (convert from FP16 if needed)\nconst getVectors = (): Float32Array[] => {\n  if (useFp16Storage && fp16Vectors && fp16Vectors.length > 0) {\n    return fp16Vectors.map(fp16 => fp16ToFloat32Array(fp16));\n  }\n  return vectors;\n};", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/integration/rag-wrapper.ts\""
// }
