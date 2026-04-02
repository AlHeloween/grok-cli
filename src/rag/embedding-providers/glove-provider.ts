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
   * Compute document embedding from a list of tokens and a vector map.
   */
  private computeAverageEmbedding(tokens: string[], vectorLookup: (token: string) => Float32Array | null | undefined): number[] {
    if (tokens.length === 0) {
      return new Array(this.dimension).fill(0);
    }

    const sumVector = new Float32Array(this.dimension);
    let validWordCount = 0;

    for (const token of tokens) {
      const vector = vectorLookup(token);
      if (vector && vector.length === this.dimension) {
        for (let i = 0; i < this.dimension; i++) {
          sumVector[i] += vector[i];
        }
        validWordCount++;
      }
    }

    if (validWordCount === 0) {
      return new Array(this.dimension).fill(0);
    }

    // Average and normalize
    const result = new Float32Array(this.dimension);
    let normSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      const avg = sumVector[i] / validWordCount;
      result[i] = avg;
      normSq += avg * avg;
    }

    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        result[i] /= norm;
      }
    }
    
    return Array.from(result);
  }

  /**
   * Compute embedding for a text by averaging word vectors.
   * Words not in vocabulary are skipped.
   */
  async embed(text: string): Promise<number[]> {
    await this.ensureLoader();

    const tokens = tokenize(text);
    return this.computeAverageEmbedding(tokens, (token) => this.loader!.getVectorAsFloat32(token));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoader();
    
    // 1. Tokenize all texts and collect unique tokens
    const textTokens = texts.map(text => tokenize(text));
    const allUniqueTokens = new Set<string>();
    for (const tokens of textTokens) {
      for (const token of tokens) {
        allUniqueTokens.add(token);
      }
    }

    // 2. Fetch all required vectors in a single batch
    const vectorMap = this.loader!.getVectorsBatch(Array.from(allUniqueTokens));

    // 3. Compute embedding for each text using the fetched vectors
    return textTokens.map(tokens => this.computeAverageEmbedding(tokens, (token) => vectorMap.get(token)));
  }
}