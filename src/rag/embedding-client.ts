import { IEmbeddingProvider } from "./embedding-provider-base.js";
import { createEmbeddingProviderFromSettings } from "./embedding-factory.js";

/**
 * Legacy options for OpenAI-compatible API (deprecated).
 * @deprecated Use IEmbeddingProvider instead.
 */
export interface EmbeddingClientOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
}

/**
 * EmbeddingClient wrapper that delegates to an embedding provider.
 * Maintains backward compatibility with existing code.
 */
export class EmbeddingClient {
  private provider: IEmbeddingProvider;

  /**
   * Create a client that delegates to the given provider.
   */
  constructor(provider: IEmbeddingProvider) {
    this.provider = provider;
  }

  /**
   * Get the provider name (legacy getModel).
   */
  getModel(): string {
    return this.provider.getName();
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  /**
   * Embed multiple text strings in batch.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.provider.embedBatch(texts);
  }

  /**
   * Get the embedding dimension (useful for vector DB initialization).
   */
  getDimension(): number {
    return this.provider.getDimension();
  }
}

/**
 * Create an embedding client from settings (main entry point).
 * This function now uses the provider factory to support multiple embedding providers.
 */
export function createEmbeddingClientFromSettings(): EmbeddingClient {
  const provider = createEmbeddingProviderFromSettings();
  return new EmbeddingClient(provider);
}