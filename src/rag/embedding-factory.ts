import { IEmbeddingProvider, EmbeddingProviderOptions } from "./embedding-provider-base.js";
import { OpenAiEmbeddingProvider } from "./embedding-providers/openai-provider.js";
import { GloveEmbeddingProvider } from "./embedding-providers/glove-provider.js";
import { HashEmbeddingProvider } from "./embedding-providers/hash-provider.js";
import { getSettingsManager } from "../utils/settings-manager.js";

/**
 * Create an embedding provider based on options.
 */
export function createEmbeddingProvider(options: EmbeddingProviderOptions): IEmbeddingProvider {
  switch (options.provider) {
    case 'openai': {
      const apiKey = options.apiKey;
      const baseURL = options.baseURL;
      if (!apiKey) {
        throw new Error('apiKey is required for openai provider');
      }
      if (!baseURL) {
        throw new Error('baseURL is required for openai provider');
      }
      // TypeScript now knows these are non-null after the checks
      return new OpenAiEmbeddingProvider({
        apiKey: apiKey as string,
        baseURL: baseURL as string,
        model: options.model || 'text-embedding-3-small',
        timeoutMs: options.timeoutMs,
      });
    }
      
    case 'glove':
      if (!options.gloveModelPath) {
        throw new Error('gloveModelPath is required for glove provider');
      }
      return new GloveEmbeddingProvider(options.gloveModelPath);
      
    case 'hash':
      return new HashEmbeddingProvider(options.hashDimension || 256);
      
    default:
      throw new Error(`Unsupported embedding provider: ${options.provider}`);
  }
}

/**
 * Create embedding provider from settings.
 * This is the main entry point for the RAG system.
 */
export function createEmbeddingProviderFromSettings(): IEmbeddingProvider {
  const settings = getSettingsManager();
  const embeddings = settings.getEmbeddingsSettings(process.cwd());
  
  // Use embeddings-specific API key if provided, otherwise fall back to main API key
  const apiKey = embeddings.apiKey || settings.getApiKey();
  if (!apiKey) {
    throw new Error("Missing API key for embeddings (set embeddings.apiKey, GROK_API_KEY, or ~/.grok/user-settings.json)");
  }
  // Use embeddings-specific base URL if provided, otherwise fall back to main base URL
  const baseURL = embeddings.baseURL || settings.getBaseURL();
  
  return createEmbeddingProvider({
    provider: embeddings.provider || 'openai',
    baseURL,
    model: embeddings.model || 'text-embedding-3-small',
    apiKey,
    gloveModelPath: embeddings.gloveModelPath,
    hashDimension: embeddings.hashDimension,
    timeoutMs: 120_000,
  });
}