import { get_encoding, encoding_for_model, Tiktoken, type TiktokenModel } from 'tiktoken';
import type { GrokMessage, UserContentPart } from '../grok/client.js';

// Global cache for Tiktoken encoders to avoid expensive re-initialization (~100ms per instantiation).
const ENCODER_CACHE = new Map<string, Tiktoken>();

export class TokenCounter {
  private encoder: Tiktoken;

  constructor(model: string = 'gpt-4') {
    let encodingName: string;
    let tiktokenModel: TiktokenModel | undefined;

    if (model && model.toLowerCase().includes('grok')) {
      // Grok model names are not mapped by tiktoken; use a stable fallback encoding.
      encodingName = 'cl100k_base';
    } else {
      try {
        // Try to determine the encoding name for the specific model
        tiktokenModel = model as TiktokenModel;
        encodingName = 'cl100k_base'; // Default if encoding_for_model doesn't work directly
      } catch {
        encodingName = 'cl100k_base';
      }
    }

    // Check cache first
    const cacheKey = tiktokenModel || encodingName;
    const cached = ENCODER_CACHE.get(cacheKey);
    if (cached) {
      this.encoder = cached;
      return;
    }

    // Initialize and cache
    try {
      if (tiktokenModel) {
        this.encoder = encoding_for_model(tiktokenModel);
      } else {
        this.encoder = get_encoding(encodingName as 'cl100k_base');
      }
    } catch {
      this.encoder = get_encoding('cl100k_base');
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
   * Clean up resources. Since encoders are now cached globally,
   * this is a no-op to prevent freeing the shared instance.
   */
  dispose(): void {
    // No-op for cached encoders
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