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
    const trimmed = texts.map((t) => t.trim());
    const nonEmptyIndices = trimmed
      .map((t, i) => (t ? i : -1))
      .filter((i) => i !== -1);

    if (nonEmptyIndices.length === 0) {
      return texts.map(() => []);
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: nonEmptyIndices.map((i) => trimmed[i]),
    });

    const apiVectors = (response.data || []).map((d) => d.embedding);
    if (apiVectors.length !== nonEmptyIndices.length || !apiVectors.every((v) => Array.isArray(v))) {
      throw new Error("Embeddings API returned invalid vectors");
    }

    const result: number[][] = texts.map(() => []);
    for (let i = 0; i < nonEmptyIndices.length; i++) {
      result[nonEmptyIndices[i]] = apiVectors[i] as number[];
    }
    return result;
  }
}