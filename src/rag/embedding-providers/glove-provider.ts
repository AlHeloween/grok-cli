import * as path from "path";
import { IEmbeddingProvider } from "../embedding-provider-base.js";
import { SqliteGloVeLoader, createSqliteGloVeLoader } from "../../aurora/glove/sqlite-loader.js";

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
 * GloVe embedding provider.
 * Uses local GloVe SQLite database to compute document embeddings by averaging word vectors.
 */
export class GloveEmbeddingProvider implements IEmbeddingProvider {
  private loader: SqliteGloVeLoader | null = null;
  private dimension: number = 0;
  private gloveModelPath: string;

  constructor(gloveModelPath: string) {
    this.gloveModelPath = gloveModelPath;
  }

  getName(): string {
    return `GloVe (${path.basename(this.gloveModelPath)})`;
  }

  getDimension(): number {
    return this.dimension;
  }

  /**
   * Initialize the loader if not already initialized.
   */
  private async ensureLoader(): Promise<void> {
    if (this.loader) return;

    try {
      this.loader = await createSqliteGloVeLoader(this.gloveModelPath);
      this.dimension = this.loader.getDimension();
    } catch (error) {
      throw new Error(`Failed to load GloVe database at ${this.gloveModelPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Compute embedding for a text by averaging word vectors.
   * Words not in vocabulary are skipped.
   */
  async embed(text: string): Promise<number[]> {
    await this.ensureLoader();
    
    const tokens = tokenize(text);
    if (tokens.length === 0) {
      // Return zero vector if no valid tokens
      return new Array(this.dimension).fill(0);
    }

    // Use Float32Array for accumulation to reduce GC pressure and improve speed
    let sumVector: Float32Array | null = null;
    let validWordCount = 0;

    for (const token of tokens) {
      // Use getVectorAsFloat32 to avoid intermediate array copies
      const vector = this.loader!.getVectorAsFloat32(token);
      if (vector && vector.length === this.dimension) {
        if (sumVector === null) {
          sumVector = new Float32Array(vector);
        } else {
          for (let i = 0; i < this.dimension; i++) {
            sumVector[i] += vector[i];
          }
        }
        validWordCount++;
      }
    }

    if (sumVector === null || validWordCount === 0) {
      // No words in vocabulary, return zero vector
      return new Array(this.dimension).fill(0);
    }

    // Average and normalize directly on the Float32Array
    let squaredSum = 0;
    for (let i = 0; i < this.dimension; i++) {
      sumVector[i] /= validWordCount;
      squaredSum += sumVector[i] * sumVector[i];
    }
    
    const norm = Math.sqrt(squaredSum);
    if (norm > 1e-9) {
      for (let i = 0; i < this.dimension; i++) {
        sumVector[i] /= norm;
      }
    }
    
    return Array.from(sumVector);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoader();

    // Prefetch all unique tokens across all texts to solve the N+1 query problem
    const allTokens = texts.map(t => tokenize(t));
    const uniqueTokens = Array.from(new Set(allTokens.flat()));
    this.loader!.prefetch(uniqueTokens);
    
    const embeddings: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      // Use the pre-tokenized version to skip re-tokenizing in embed()
      // Since embed() currently re-tokenizes, we'll just call it normally,
      // but it will hit the warmed-up cache.
      embeddings.push(await this.embed(texts[i]));
    }
    return embeddings;
  }
}