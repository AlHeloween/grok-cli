import * as fs from "fs";


export interface GloVeVector {
  word: string;
  vector: number[];
  norm: number;
}

export class GloVeLoader {
  public vectors: Map<string, number[]> = new Map();
  public norms: Map<string, number> = new Map();
  public dimension: number = 0;

  /**
   * Load GloVe vectors from a text file (space-separated, first token is word).
   */
  async loadFromFile(filePath: string): Promise<void> {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter(line => line.trim());

    for (const line of lines) {
      const parts = line.split(" ");
      if (parts.length < 2) continue;

      const word = parts[0];
      const vector = parts.slice(1).map(Number);

      if (this.dimension === 0) {
        this.dimension = vector.length;
      } else if (vector.length !== this.dimension) {
        continue; // skip malformed lines
      }

      // Normalize vector to unit length
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      const normalized = norm > 0 ? vector.map(v => v / norm) : vector;

      this.vectors.set(word, normalized);
      this.norms.set(word, norm);
    }
  }

  /**
   * Load GloVe vectors from a URL (fetches and caches locally).
   */
  async loadFromUrl(_url: string, _cacheDir?: string): Promise<void> {
    // For reference implementation, we'll just throw
    throw new Error("loadFromUrl not implemented in reference version");
  }

  getDimension(): number {
    return this.dimension;
  }

  getVector(word: string): number[] | undefined {
    return this.vectors.get(word.toLowerCase());
  }

  getNorm(word: string): number {
    return this.norms.get(word.toLowerCase()) || 0;
  }

  hasWord(word: string): boolean {
    return this.vectors.has(word.toLowerCase());
  }

  /**
   * Cosine similarity between two words.
   */
  similarity(word1: string, word2: string): number {
    const v1 = this.getVector(word1);
    const v2 = this.getVector(word2);
    if (!v1 || !v2) return 0;

    let dot = 0;
    for (let i = 0; i < this.dimension; i++) {
      dot += v1[i] * v2[i];
    }
    return dot; // vectors are already normalized
  }

  /**
   * Find top K words most similar to a target vector.
   */
  findSimilarWords(targetVector: number[], topK: number = 10): Array<{word: string, score: number}> {
    const results: Array<{word: string, score: number}> = [];

    for (const [word, vector] of this.vectors.entries()) {
      let dot = 0;
      for (let i = 0; i < this.dimension; i++) {
        dot += targetVector[i] * vector[i];
      }
      results.push({ word, score: dot });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Find top K words most similar to a target word.
   */
  findSimilarToWord(targetWord: string, topK: number = 10): Array<{word: string, score: number}> {
    const targetVector = this.getVector(targetWord);
    if (!targetVector) return [];
    return this.findSimilarWords(targetVector, topK);
  }

  /**
   * Get all words in vocabulary.
   */
  getVocabulary(): string[] {
    return Array.from(this.vectors.keys());
  }
}

/**
 * Create a GloVe loader with a small test vocabulary (for reference/testing).
 */
export function createTestGloVeLoader(): GloVeLoader {
  // Create a mini loader with a few words for testing
  const loader = new GloVeLoader();
  // Mock vectors for testing
  const mockVectors: Record<string, number[]> = {
    "apple": [0.1, 0.2, 0.3],
    "banana": [0.2, 0.3, 0.4],
    "fruit": [0.15, 0.25, 0.35],
    "computer": [0.9, 0.8, 0.7],
    "technology": [0.85, 0.75, 0.65],
  };

  for (const [word, vector] of Object.entries(mockVectors)) {
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    const normalized = norm > 0 ? vector.map(v => v / norm) : vector;
    loader.vectors.set(word, normalized);
    loader.norms.set(word, norm);
  }
  loader.dimension = 3;

  return loader;
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/glove/loader.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-01T14:37:42.409451+00:00"
//   "new_hash": "d699f77fe26dc1c404cecf9d384d6644"
//   "goal_id": "create_src_aurora_glove_loader_ts"
//   "semantics": "Create src/aurora/glove/loader.ts (Aurora reference implementation)"
//   "update_attrs": {"relative_path": "src/aurora/glove/loader.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/glove/loader.ts\""
// }
