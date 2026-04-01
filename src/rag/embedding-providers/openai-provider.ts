import OpenAI from "openai";
import { IEmbeddingProvider } from "../embedding-provider-base.js";

export interface OpenAiEmbeddingProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
}

/**
 * OpenAI-compatible embedding provider.
 * This is the default provider that uses external API.
 */
export class OpenAiEmbeddingProvider implements IEmbeddingProvider {
  private client: OpenAI;
  private model: string;

  constructor(options: OpenAiEmbeddingProviderOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs ?? 120_000,
    });
  }

  getName(): string {
    return `OpenAI (${this.model})`;
  }

  getDimension(): number {
    // OpenAI embeddings dimension varies by model
    // For text-embedding-3-small: 1536
    // For text-embedding-3-large: 3072
    // We'll determine dynamically on first embed
    return 0; // Will be set after first successful embed
  }

  async embed(text: string): Promise<number[]> {
    const input = text.trim();
    if (!input) return [];

    const response = await this.client.embeddings.create({
      model: this.model,
      input,
    });

    const vector = response.data?.[0]?.embedding;
    if (!Array.isArray(vector)) {
      throw new Error("Embeddings API returned no vector");
    }
    return vector as number[];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Filter out empty/whitespace strings for the API call, but maintain index mapping
    const nonEmptyIndices: number[] = [];
    const inputs = texts.map((text, i) => {
      const t = text.trim();
      if (t) {
        nonEmptyIndices.push(i);
        return t;
      }
      return null;
    }).filter((t): t is string => t !== null);

    if (inputs.length === 0) {
      return texts.map(() => []);
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: inputs,
    });

    const vectors = (response.data || []).map((d) => d.embedding);
    if (vectors.length !== inputs.length || !vectors.every((v) => Array.isArray(v))) {
      throw new Error("Embeddings API returned invalid vectors");
    }

    // Map vectors back to original indices, preserving 1:1 mapping
    const result: number[][] = texts.map(() => []);
    for (let i = 0; i < nonEmptyIndices.length; i++) {
      result[nonEmptyIndices[i]] = vectors[i] as number[];
    }
    return result;
  }
}