/**
 * Text‑fractal memory bank (reference implementation).
 * Based on Aurora‑Genesis memory/text_fractal_memory.py.
 * Uses hash‑based deterministic embedding and Sierpinski centroids for clustering.
 */

import { generateSierpinskiCentroids, findNearestCentroid } from "../fractal/sierpinski.js";

export interface TextEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, any> /* eslint-disable-line @typescript-eslint/no-explicit-any */;
  timestamp?: number;
}

export interface TextFractalMemoryOptions {
  /** Number of dimensions for embedding space */
  dim: number;
  /** Number of hierarchical levels */
  nLevels: number;
  /** Number of centroids per level */
  nPerLevel: number;
  /** Seed for deterministic centroid generation */
  seed?: number;
}

/**
 * Deterministic embedding via hashing (reference implementation).
 * In production, use a proper embedding model.
 */
function hashEmbedding(text: string, dim: number): number[] {
  // Simple deterministic hash-based embedding for reference
  const hash = (str: string): number => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0; // Convert to 32-bit integer
    }
    return h;
  };

  const embedding: number[] = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    const seed = hash(text + i.toString());
    // Map to [-1, 1]
    embedding[i] = (seed % 10000) / 5000 - 1;
  }

  // Normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

export class TextFractalMemoryBank {
  private entries: Map<string, TextEntry> = new Map();
  private centroids: number[][][] = []; // [level][centroidIndex][dim]
  private levelToEntries: Map<number, Set<string>> = new Map();
  private options: TextFractalMemoryOptions;

  constructor(options: TextFractalMemoryOptions) {
    this.options = options;
    this.initCentroids();
  }

  private initCentroids(): void {
    const { dim, nLevels, nPerLevel, seed } = this.options;

    for (let level = 0; level < nLevels; level++) {
      // Generate centroids for this level
      const centroids = generateSierpinskiCentroids({
        nDim: dim,
        depth: 1,
        seed: (seed || 1234) + level * 1000,
        maxCentroids: nPerLevel,
      });
      this.centroids[level] = centroids;
      this.levelToEntries.set(level, new Set());
    }
  }

  /**
   * Add a text entry to memory.
   */
  add(text: string, metadata?: Record<string, any> /* eslint-disable-line @typescript-eslint/no-explicit-any */): string {
    const id = `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const embedding = hashEmbedding(text, this.options.dim);

    const entry: TextEntry = {
      id,
      text,
      embedding,
      metadata,
      timestamp: Date.now(),
    };

    this.entries.set(id, entry);

    // Assign to nearest centroid at each level
    for (let level = 0; level < this.options.nLevels; level++) {
      const centroids = this.centroids[level];
      const { index: _index } = findNearestCentroid(embedding, centroids);
      // Store mapping (in reference implementation, just track)
      // In full implementation, would maintain inverted index
    }

    return id;
  }

  /**
   * Query similar entries by text.
   */
  query(
    text: string,
    k: number = 5,
    _level?: number
  ): Array<{ entry: TextEntry; similarity: number }> {
    const queryEmbedding = hashEmbedding(text, this.options.dim);

    // Simple linear scan (reference implementation)
    const results: Array<{ entry: TextEntry; similarity: number }> = [];

    for (const entry of this.entries.values()) {
      // Cosine similarity
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < this.options.dim; i++) {
        dot += queryEmbedding[i] * entry.embedding[i];
        normA += queryEmbedding[i] * queryEmbedding[i];
        normB += entry.embedding[i] * entry.embedding[i];
      }

      const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9);
      results.push({ entry, similarity });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }

  /**
   * Query by embedding vector.
   */
  queryByEmbedding(
    embedding: number[],
    k: number = 5
  ): Array<{ entry: TextEntry; similarity: number }> {
    const results: Array<{ entry: TextEntry; similarity: number }> = [];

    for (const entry of this.entries.values()) {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < this.options.dim; i++) {
        dot += embedding[i] * entry.embedding[i];
        normA += embedding[i] * embedding[i];
        normB += entry.embedding[i] * entry.embedding[i];
      }

      const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9);
      results.push({ entry, similarity });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }

  /**
   * Get entry by ID.
   */
  get(id: string): TextEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Delete entry by ID.
   */
  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Get statistics.
   */
  getStats(): {
    totalEntries: number;
    entriesPerLevel: Record<number, number>;
  } {
    const entriesPerLevel: Record<number, number> = {};
    for (let level = 0; level < this.options.nLevels; level++) {
      entriesPerLevel[level] = this.levelToEntries.get(level)?.size || 0;
    }

    return {
      totalEntries: this.entries.size,
      entriesPerLevel,
    };
  }
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/memory/text-fractal-memory.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-01T14:37:42.440538+00:00"
//   "new_hash": "e46d6d31353ff5dbeb56062c51a82a1c"
//   "goal_id": "create_src_aurora_memory_text-fractal-memory_ts"
//   "semantics": "Create src/aurora/memory/text-fractal-memory.ts (Aurora reference implementation)"
//   "update_attrs": {"relative_path": "src/aurora/memory/text-fractal-memory.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/memory/text-fractal-memory.ts\""
// }
