import { get_encoding, encoding_for_model, Tiktoken, type TiktokenModel } from 'tiktoken';
import type { GrokMessage, UserContentPart } from '../grok/client.js';

export class TokenCounter {
  // Global cache for encoders to avoid expensive ~100ms initialization per instance
  private static cache = new Map<string, Tiktoken>();
  private encoder: Tiktoken;

  constructor(model: string = 'gpt-4') {
    const encodingName = this.resolveEncodingName(model);

    // Return cached encoder if available
    if (TokenCounter.cache.has(encodingName)) {
      this.encoder = TokenCounter.cache.get(encodingName)!;
      return;
    }

    try {
      if (encodingName === 'cl100k_base') {
        this.encoder = get_encoding('cl100k_base');
      } else {
        this.encoder = encoding_for_model(encodingName as TiktokenModel);
      }
    } catch {
      // Fallback to cl100k_base
      this.encoder = get_encoding('cl100k_base');
    }

    // Cache the encoder for future use
    TokenCounter.cache.set(encodingName, this.encoder);
  }

  /**
   * Resolve the appropriate encoding name for a given model
   */
  private resolveEncodingName(model: string): string {
    if (model && model.toLowerCase().includes('grok')) {
      // Grok model names are not mapped by tiktoken; use a stable fallback encoding.
      return 'cl100k_base';
    }
    return model;
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
   * Since we're using a global cache, we don't free the encoder here.
   */
  dispose(): void {
    // No-op for cached encoders to persist for process lifetime
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
