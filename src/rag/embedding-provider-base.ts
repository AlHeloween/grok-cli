/**
 * Base interface for embedding providers.
 */
export interface IEmbeddingProvider {
  /**
   * Embed a single text string.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Embed multiple text strings in batch.
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Get the dimension of embeddings produced by this provider.
   */
  getDimension(): number;

  /**
   * Get provider name for logging/debugging.
   */
  getName(): string;
}

/**
 * Options for creating embedding providers.
 */
export interface EmbeddingProviderOptions {
  /** Provider type */
  provider: 'openai' | 'glove' | 'hash';
  /** OpenAI-compatible API base URL (for openai provider) */
  baseURL?: string;
  /** Model name (for openai provider) */
  model?: string;
  /** API key (for openai provider) */
  apiKey?: string;
  /** Path to GloVe SQLite database (for glove provider) */
  gloveModelPath?: string;
  /** Dimension for hash embeddings (for hash provider) */
  hashDimension?: number;
  /** Timeout in milliseconds (for openai provider) */
  timeoutMs?: number;
}