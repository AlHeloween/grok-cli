import { get_encoding, encoding_for_model, Tiktoken, type TiktokenModel } from 'tiktoken';
import type { GrokMessage, UserContentPart } from '../grok/client.js';

// Global cache for encoders to avoid expensive re-initialization (WASM load + vocab)
const ENCODER_CACHE: Map<string, Tiktoken> = new Map();

export class TokenCounter {
  private encoder: Tiktoken;

  constructor(model: string = 'gpt-4') {
    const normalizedModel = model.toLowerCase();
    let cacheKey = normalizedModel;

    if (normalizedModel.includes('grok')) {
      // Grok model names are not mapped by tiktoken; use cl100k_base.
      cacheKey = 'cl100k_base';
    }

    const cached = ENCODER_CACHE.get(cacheKey);
    if (cached) {
      this.encoder = cached;
      return;
    }

    if (cacheKey === 'cl100k_base') {
      this.encoder = get_encoding('cl100k_base');
    } else {
      try {
        this.encoder = encoding_for_model(cacheKey as TiktokenModel);
      } catch {
        // Fallback to cl100k_base (used by GPT-4 and most modern models)
        cacheKey = 'cl100k_base';
        const cl100k = ENCODER_CACHE.get(cacheKey);
        if (cl100k) {
          this.encoder = cl100k;
        } else {
          this.encoder = get_encoding('cl100k_base');
        }
      }
    }

    ENCODER_CACHE.set(cacheKey, this.encoder);
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
   * Since encoders are now shared via ENCODER_CACHE, dispose is a no-op to prevent
   * freeing the shared WASM instance while other counters are still using it.
   */
  dispose(): void {
    // No-op for shared encoder
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