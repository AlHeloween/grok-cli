import { get_encoding, encoding_for_model, Tiktoken, type TiktokenModel } from 'tiktoken';
import type { GrokMessage, UserContentPart } from '../grok/client.js';

export class TokenCounter {
  private encoder: Tiktoken;
  private static encoderCache: Map<string, Tiktoken> = new Map();

  constructor(model: string = 'gpt-4') {
    const encodingName = this.getEncodingName(model);

    // Check cache first - initializing Tiktoken is expensive (~100ms)
    let cached = TokenCounter.encoderCache.get(encodingName);
    if (!cached) {
      try {
        if (model && !model.toLowerCase().includes('grok')) {
          cached = encoding_for_model(model as TiktokenModel);
        } else {
          cached = get_encoding('cl100k_base');
        }
      } catch {
        cached = get_encoding('cl100k_base');
      }
      TokenCounter.encoderCache.set(encodingName, cached);
    }
    this.encoder = cached;
  }

  private getEncodingName(model: string): string {
    if (!model || model.toLowerCase().includes('grok')) {
      return 'cl100k_base';
    }
    // This is a bit of a hack because tiktoken doesn't expose a direct
    // model-to-encoding-name mapping without instantiating, but for
    // caching purposes we just need a stable key.
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
   * Since we use a shared cache, we no longer free the encoder here
   * to keep it available for other instances. Encoders will persist
   * for the lifetime of the process.
   */
  dispose(): void {
    // No-op: encoders are managed by the static cache
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