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

    let sumVector: number[] | null = null;
    let validWordCount = 0;

    for (const token of tokens) {
      const vector = this.loader!.getVectorAsArray(token);
      if (vector && vector.length === this.dimension) {
        if (sumVector === null) {
          sumVector = [...vector];
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

    // Average and normalize
    const avgVector = sumVector.map(v => v / validWordCount);
    const norm = Math.sqrt(avgVector.reduce((sum, v) => sum + v * v, 0));
    
    if (norm > 0) {
      return avgVector.map(v => v / norm);
    }
    
    return avgVector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoader();
    
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }
}