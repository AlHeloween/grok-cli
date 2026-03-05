import { IEmbeddingProvider } from "../embedding-provider-base.js";

/**
 * Deterministic hash-based embedding.
 * Uses simple hash function to create deterministic embeddings.
 */
export class HashEmbeddingProvider implements IEmbeddingProvider {
  private dimension: number;

  constructor(dimension: number = 256) {
    if (dimension < 1) {
      throw new Error(`Hash embedding dimension must be >= 1, got ${dimension}`);
    }
    this.dimension = dimension;
  }

  getName(): string {
    return `Hash (${this.dimension}d)`;
  }

  getDimension(): number {
    return this.dimension;
  }

  /**
   * Simple deterministic hash function.
   */
  private hash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0; // Convert to 32-bit integer
    }
    return h;
  }

  async embed(text: string): Promise<number[]> {
    const input = text.trim();
    if (!input) {
      return new Array(this.dimension).fill(0);
    }

    const embedding: number[] = new Array(this.dimension).fill(0);
    for (let i = 0; i < this.dimension; i++) {
      const seed = this.hash(input + i.toString());
      // Map to [-1, 1]
      embedding[i] = (seed % 10000) / 5000 - 1;
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }
}