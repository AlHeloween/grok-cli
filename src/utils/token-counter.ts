import { get_encoding, encoding_for_model, Tiktoken, type TiktokenModel } from 'tiktoken';
import type { GrokMessage, UserContentPart } from '../grok/client.js';

export class TokenCounter {
  /**
   * Global cache for Tiktoken encoders to avoid expensive re-initialization (~180ms per load).
   */
  private static readonly ENCODER_CACHE = new Map<string, Tiktoken>();

  private encoder: Tiktoken;

  constructor(model: string = 'gpt-4') {
    const normalizedModel = model.toLowerCase();

    // 1. Check if it's a Grok model (always cl100k_base)
    if (normalizedModel.includes('grok')) {
      this.encoder = this.getOrCreateCachedEncoder('cl100k_base');
      return;
    }

    // 2. Check cache by model name
    const cached = TokenCounter.ENCODER_CACHE.get(normalizedModel);
    if (cached) {
      this.encoder = cached;
      return;
    }

    // 3. Try to load by model name
    try {
      this.encoder = encoding_for_model(model as TiktokenModel);
      TokenCounter.ENCODER_CACHE.set(normalizedModel, this.encoder);
    } catch {
      // 4. Fallback to cl100k_base
      this.encoder = this.getOrCreateCachedEncoder('cl100k_base');
      // Also cache this model name as pointing to the fallback encoder to avoid future catch blocks
      TokenCounter.ENCODER_CACHE.set(normalizedModel, this.encoder);
    }
  }

  /**
   * Get an encoder from the cache or create it if it doesn't exist.
   */
  private getOrCreateCachedEncoder(encoding: 'cl100k_base'): Tiktoken {
    let cached = TokenCounter.ENCODER_CACHE.get(encoding);
    if (!cached) {
      cached = get_encoding(encoding);
      TokenCounter.ENCODER_CACHE.set(encoding, cached);
    }
    return cached;
  }

  /**
   * Count tokens in a string
   */
  countTokens(text: string): number {
    if (!text) return 0;
    return this.encoder.encode(text).length;
  }

  /**
   * Count tokens in messages array (for chat completions)
   */
  countMessageTokens(messages: GrokMessage[]): number {
    let totalTokens = 0;
    
    for (const message of messages) {
      // Every message follows <|start|>{role/name}\n{content}<|end|\>\n
      totalTokens += 3; // Base tokens per message
      
      if (message.content) {
        if (typeof message.content === 'string') {
          totalTokens += this.countTokens(message.content);
        } else if (Array.isArray(message.content)) {
          // Handle UserContentPart array
          for (const part of message.content as UserContentPart[]) {
            if (part.type === 'input_text' && part.text) {
              totalTokens += this.countTokens(part.text);
            }
            // Input image parts don't contribute text tokens
          }
        }
      }
      
      if (message.role) {
        totalTokens += this.countTokens(message.role);
      }
      
      // Add extra tokens for tool calls if present
      if (message.tool_calls) {
        totalTokens += this.countTokens(JSON.stringify(message.tool_calls));
      }
    }
    
    totalTokens += 3; // Every reply is primed with <|start|>assistant<|message|>
    
    return totalTokens;
  }

  /**
   * Estimate tokens for streaming content
   * This is an approximation since we don't have the full response yet
   */
  estimateStreamingTokens(accumulatedContent: string): number {
    return this.countTokens(accumulatedContent);
  }

  /**
   * Clean up resources.
   * Note: In this optimized version, encoders are shared in a global cache and
   * persist for the lifetime of the process. Dispose is now a no-op to prevent
   * freeing shared encoders.
   */
  dispose(): void {
    // No-op: encoders are managed by the global ENCODER_CACHE
  }
}

/**
 * Format token count for display (e.g., 1.2k for 1200)
 */
export function formatTokenCount(count: number): string {
  if (count <= 999) {
    return count.toString();
  }
  
  if (count < 1_000_000) {
    const k = count / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  
  const m = count / 1_000_000;
  return m % 1 === 0 ? `${m}m` : `${m.toFixed(1)}m`;
}

/**
 * Create a token counter instance
 */
export function createTokenCounter(model?: string): TokenCounter {
  return new TokenCounter(model);
}