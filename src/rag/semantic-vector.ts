import { selectKMedoids, type KMedoidsDistance } from "./k-medoids.js";

export interface KeywordWeight {
  keyword: string;
  weight: number;
}

/**
 * Basic English stopwords list (short)
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should", "may", "might", "must", "can", "could", "i", "you", "he", "she",
  "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their", "this", "that", "these", "those", "am", "not",
]);

/**
 * Tokenize text into lowercase words, removing stopwords and non‑alphabetic characters.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Compute TF‑IDF scores for a list of documents.
 * Returns a map from word to score for each document.
 */
function computeTfIdf(docs: string[]): Map<string, number>[] {
  const tokenizedDocs = docs.map(tokenize);
  const docCount = docs.length;
  const wordDocCount = new Map<string, number>();

  for (const tokens of tokenizedDocs) {
    const seen = new Set<string>();
    for (const token of tokens) {
      if (!seen.has(token)) {
        wordDocCount.set(token, (wordDocCount.get(token) || 0) + 1);
        seen.add(token);
      }
    }
  }

  const idf = new Map<string, number>();
  for (const [word, count] of wordDocCount) {
    idf.set(word, Math.log((docCount + 1) / (count + 1)) + 1);
  }

  const tfIdfMaps: Map<string, number>[] = [];
  for (const tokens of tokenizedDocs) {
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }
    const tfIdf = new Map<string, number>();
    for (const [word, tf] of termFreq) {
      tfIdf.set(word, tf * (idf.get(word) || 1));
    }
    tfIdfMaps.push(tfIdf);
  }

  return tfIdfMaps;
}

function toFloat32Arrays(embeddings: number[][]): Float32Array[] {
  return embeddings.map(vec => new Float32Array(vec));
}

/**
 * Cluster embeddings using k‑medoids.
 * @param embeddings List of embedding vectors (number[][] or Float32Array[])
 * @param k Number of clusters (default min(5, numEntries))
 * @param distanceMetric 'cosine' or 'l2'
 * @returns Object with cluster labels (0‑based) and medoid indices
 */
export function clusterEmbeddings(
  embeddings: number[][] | Float32Array[],
  k: number = Math.min(5, embeddings.length),
  distanceMetric: KMedoidsDistance = "cosine"
): { labels: number[]; medoids: number[] } {
  if (embeddings.length <= k) {
    // Each point its own cluster
    const labels = Array.from({ length: embeddings.length }, (_, i) => i);
    return { labels, medoids: labels };
  }

  const floatVectors = Array.isArray(embeddings[0]) && typeof embeddings[0][0] === "number"
    ? toFloat32Arrays(embeddings as number[][])
    : embeddings as Float32Array[];

  const medoidIndices = selectKMedoids(floatVectors, k, distanceMetric);
  // Assign each point to the nearest medoid
  const labels: number[] = [];
  for (let idx = 0; idx < floatVectors.length; idx++) {
    const vec = floatVectors[idx];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < medoidIndices.length; i++) {
      const medoidVec = floatVectors[medoidIndices[i]];
      // Use cosine distance (same as in k-medoids)
      const dot = Array.from(vec).reduce((sum, v, j) => sum + v * medoidVec[j], 0);
      const normA = Math.sqrt(Array.from(vec).reduce((sum, v) => sum + v * v, 0));
      const normB = Math.sqrt(Array.from(medoidVec).reduce((sum, v) => sum + v * v, 0));
      const dist = 1 - dot / (normA * normB + 1e-9);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    labels.push(bestIdx);
  }
  return { labels, medoids: medoidIndices };
}

/**
 * Extract top keywords for each cluster based on TF‑IDF within the cluster.
 * @param texts All texts (same order as embeddings)
 * @param clusterLabels Cluster assignment for each text
 * @param keywordsPerCluster Number of keywords to extract per cluster
 * @returns Map from cluster index to array of KeywordWeight
 */
export function extractClusterKeywords(
  texts: string[],
  clusterLabels: number[],
  keywordsPerCluster: number = 5
): Map<number, KeywordWeight[]> {
  const clusterCount = Math.max(...clusterLabels) + 1;
  const clusterTexts: string[][] = Array.from({ length: clusterCount }, () => []);
  for (let i = 0; i < texts.length; i++) {
    clusterTexts[clusterLabels[i]].push(texts[i]);
  }

  const result = new Map<number, KeywordWeight[]>();
  for (let c = 0; c < clusterCount; c++) {
    const docs = clusterTexts[c];
    if (docs.length === 0) {
      result.set(c, []);
      continue;
    }
    const tfIdfMaps = computeTfIdf(docs);
    // Aggregate scores across documents in the cluster
    const wordScores = new Map<string, number>();
    for (const map of tfIdfMaps) {
      for (const [word, score] of map) {
        wordScores.set(word, (wordScores.get(word) || 0) + score);
      }
    }
    // Normalize by number of docs (optional)
    const topWords = Array.from(wordScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, keywordsPerCluster)
      .map(([keyword, weight]) => ({ keyword, weight }));
    result.set(c, topWords);
  }
  return result;
}

/**
 * Compute soft assignment weights of a vector to each cluster medoid.
 * @param vec Embedding vector
 * @param medoids List of medoid vectors
 * @returns Array of weights (sum = 1) corresponding to each medoid
 */
function softAssignment(vec: number[], medoids: number[][]): number[] {
  const similarities = medoids.map((med) => {
    const dot = vec.reduce((sum, v, idx) => sum + v * med[idx], 0);
    const normA = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    const normB = Math.sqrt(med.reduce((sum, v) => sum + v * v, 0));
    return dot / (normA * normB + 1e-9);
  });
  // Convert similarities to weights via softmax
  const exp = similarities.map((s) => Math.exp(s));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / sum);
}

/**
 * Compute semantic vector for a single entry given all session data.
 * @param entryEmbedding Embedding of the target entry
 * @param entryText Text of the target entry (used as fallback if no clusters)
 * @param allEmbeddings Embeddings of all entries in the session
 * @param allTexts Texts of all entries (same order as embeddings)
 * @param options Configuration
 * @returns Array of keyword‑weight pairs
 */
export function computeSemanticVector(
  entryEmbedding: number[],
  entryText: string,
  allEmbeddings: number[][],
  allTexts: string[],
  options: {
    maxKeywords?: number;
    clusterCount?: number;
    distanceMetric?: KMedoidsDistance;
  } = {}
): KeywordWeight[] {
  const maxKeywords = options.maxKeywords ?? 5;
  const clusterCount = options.clusterCount ?? Math.min(5, allEmbeddings.length);
  const distanceMetric = options.distanceMetric ?? "cosine";

  if (allEmbeddings.length <= 1) {
    // No clustering possible – fall back to simple TF‑IDF on the single entry
    const tfIdf = computeTfIdf([entryText])[0];
    const keywords = Array.from(tfIdf.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([keyword, weight]) => ({ keyword, weight }));
    return keywords;
  }

  const { labels, medoids } = clusterEmbeddings(allEmbeddings, clusterCount, distanceMetric);
  const clusterKeywords = extractClusterKeywords(allTexts, labels, maxKeywords);

  // Soft assignment of the target entry to each medoid
  const medoidVectors = medoids.map((idx) => allEmbeddings[idx]);
  const weights = softAssignment(entryEmbedding, medoidVectors);

  // Combine keywords from each cluster weighted by assignment weight
  const combined = new Map<string, number>();
  for (let c = 0; c < medoids.length; c++) {
    const kwList = clusterKeywords.get(c) || [];
    const w = weights[c];
    for (const { keyword, weight } of kwList) {
      combined.set(keyword, (combined.get(keyword) || 0) + weight * w);
    }
  }

  // Add fallback from the entry's own TF‑IDF with a small weight
  const ownTfIdf = computeTfIdf([entryText])[0];
  for (const [keyword, weight] of ownTfIdf) {
    combined.set(keyword, (combined.get(keyword) || 0) + weight * 0.1);
  }

  // Normalize and return top keywords
  const total = Array.from(combined.values()).reduce((sum, v) => sum + v, 0);
  const normalized = Array.from(combined.entries()).map(([keyword, weight]) => ({
    keyword,
    weight: total > 0 ? weight / total : weight,
  }));
  normalized.sort((a, b) => b.weight - a.weight);
  return normalized.slice(0, maxKeywords);
}

/**
 * Compute semantic vectors and dominant keywords for a whole session in batch.
 * This is more efficient than calling computeSemanticVector per entry.
 */
export function computeSemanticVectorsForSession(
  embeddings: number[][],
  texts: string[],
  options: {
    maxKeywords?: number;
    clusterCount?: number;
    distanceMetric?: KMedoidsDistance;
  } = {}
): { semanticVectors: KeywordWeight[][]; semanticDominants: string[] } {
  const maxKeywords = options.maxKeywords ?? 5;
  const clusterCount = options.clusterCount ?? Math.min(5, embeddings.length);
  const distanceMetric = options.distanceMetric ?? "cosine";

  if (embeddings.length <= 1) {
    // Fallback to per‑entry TF‑IDF
    const semanticVectors: KeywordWeight[][] = [];
    const semanticDominants: string[] = [];
    for (let i = 0; i < embeddings.length; i++) {
      const tfIdf = computeTfIdf([texts[i]])[0];
      const keywords = Array.from(tfIdf.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxKeywords)
        .map(([keyword, weight]) => ({ keyword, weight }));
      semanticVectors.push(keywords);
      semanticDominants.push(keywords[0]?.keyword || "");
    }
    return { semanticVectors, semanticDominants };
  }

  const { labels, medoids } = clusterEmbeddings(embeddings, clusterCount, distanceMetric);
  const clusterKeywords = extractClusterKeywords(texts, labels, maxKeywords);

  // Precompute medoid vectors (as number[][])
  const medoidVectors = medoids.map(idx => embeddings[idx]);

  const semanticVectors: KeywordWeight[][] = [];
  const semanticDominants: string[] = [];

  for (let idx = 0; idx < embeddings.length; idx++) {
    const vec = embeddings[idx];
    const weights = softAssignment(vec, medoidVectors);
    const combined = new Map<string, number>();
    for (let c = 0; c < medoids.length; c++) {
      const kwList = clusterKeywords.get(c) || [];
      const w = weights[c];
      for (const { keyword, weight } of kwList) {
        combined.set(keyword, (combined.get(keyword) || 0) + weight * w);
      }
    }
    // Add fallback from own TF‑IDF
    const ownTfIdf = computeTfIdf([texts[idx]])[0];
    for (const [keyword, weight] of ownTfIdf) {
      combined.set(keyword, (combined.get(keyword) || 0) + weight * 0.1);
    }
    // Normalize
    const total = Array.from(combined.values()).reduce((sum, v) => sum + v, 0);
    const normalized = Array.from(combined.entries()).map(([keyword, weight]) => ({
      keyword,
      weight: total > 0 ? weight / total : weight,
    }));
    normalized.sort((a, b) => b.weight - a.weight);
    const topKeywords = normalized.slice(0, maxKeywords);
    semanticVectors.push(topKeywords);
    semanticDominants.push(topKeywords[0]?.keyword || "");
  }

  return { semanticVectors, semanticDominants };
}

/**
 * Extract dominant keyword from a semantic vector.
 */
export function extractDominantKeyword(semanticVector: KeywordWeight[]): string {
  return semanticVector[0]?.keyword || "";
}