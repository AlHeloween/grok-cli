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
  provider: 'openai' | 'glove' | 'hash' | 'bitnet';
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
  /** Path to BitNet GGUF model file (for bitnet provider) */
  bitnetModelPath?: string;
  /** Transformer layer to extract Q vectors from (for bitnet provider) */
  bitnetLayer?: number;
  /** Number of trailing tokens to skip (for bitnet provider) */
  bitnetTailSkip?: number;
  /** Pooling window size (for bitnet provider) */
  bitnetPoolN?: number;
  /** Timeout in milliseconds (for openai provider) */
  timeoutMs?: number;
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/rag/embedding-provider-base.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/rag/embedding-provider-base.ts.backup_20260307T113826_566140"
//   "created_at": "2026-03-07T03:38:26.586936+00:00"
//   "backup_hash": "dd298751010785c2075a06d98c661c77"
//   "new_hash": "4b08c980e5a0cc69c8ee954869718466"
//   "goal_id": "text_anchor_replace"
//   "semantics": "Add bitnet provider type and options."
//   "update_attrs": {"relative_path": "src/rag/embedding-provider-base.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "export interface EmbeddingProviderOptions {\n  /** Provider type */\n  provider: 'openai' | 'glove' | 'hash';\n  /** OpenAI-compatible API base URL (for openai provider) */\n  baseURL?: string;\n  /** Model name (for openai provider) */\n  model?: string;\n  /** API key (for openai provider) */\n  apiKey?: string;\n  /** Path to GloVe SQLite database (for glove provider) */\n  gloveModelPath?: string;\n  /** Dimension for hash embeddings (for hash provider) */\n  hashDimension?: number;\n  /** Timeout in milliseconds (for openai provider) */\n  timeoutMs?: number;\n}", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/rag/embedding-provider-base.ts\""
// }
