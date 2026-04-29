import { get_encoding, encoding_for_model, Tiktoken, type TiktokenModel } from 'tiktoken';
import type { GrokMessage, UserContentPart } from '../grok/client.js';

/**
 * Global cache for Tiktoken encoders to avoid expensive re-initialization (WASM/vocabulary loading).
 */
const ENCODER_CACHE = new Map<string, Tiktoken>();

function getCachedEncoding(encodingName: string): Tiktoken {
  let encoder = ENCODER_CACHE.get(encodingName);
  if (!encoder) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    encoder = get_encoding(encodingName as any);
    ENCODER_CACHE.set(encodingName, encoder);
  }
  return encoder;
}

function getCachedEncodingForModel(model: string): Tiktoken {
  let encoder = ENCODER_CACHE.get(model);
  if (!encoder) {
    try {
      encoder = encoding_for_model(model as TiktokenModel);
      ENCODER_CACHE.set(model, encoder);
    } catch {
      // Fallback to cl100k_base (used by GPT-4 and most modern models)
      return getCachedEncoding('cl100k_base');
    }
  }
  return encoder;
}

export class TokenCounter {
  private encoder: Tiktoken;

  constructor(model: string = 'gpt-4') {
    if (model && model.toLowerCase().includes('grok')) {
      // Grok model names are not mapped by tiktoken; use a stable fallback encoding.
      this.encoder = getCachedEncoding('cl100k_base');
      return;
    }

    this.encoder = getCachedEncodingForModel(model);
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
   * Clean up resources
   */
  dispose(): void {
    // No-op because encoders are shared in the global cache and
    // should persist for the lifetime of the process.
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
