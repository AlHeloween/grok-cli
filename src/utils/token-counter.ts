import { get_encoding, encoding_for_model, Tiktoken, type TiktokenModel } from 'tiktoken';
import type { GrokMessage, UserContentPart } from '../grok/client.js';

export class TokenCounter {
  private static readonly ENCODER_CACHE: Map<string, Tiktoken> = new Map();
  private encoder: Tiktoken;

  constructor(model: string = 'gpt-4') {
    const normalizedModel = model.toLowerCase();
    let encoderKey = 'cl100k_base';

    if (!normalizedModel.includes('grok')) {
      try {
        // Tiktoken encoding_for_model is relatively fast if we just want the encoding name,
        // but unfortunately it returns the Tiktoken object itself in this JS binding.
        // So we use it to get the encoder and cache it. Use lowercase key for normalization.
        if (TokenCounter.ENCODER_CACHE.has(normalizedModel)) {
          this.encoder = TokenCounter.ENCODER_CACHE.get(normalizedModel)!;
          return;
        }
        this.encoder = encoding_for_model(model as TiktokenModel);
        TokenCounter.ENCODER_CACHE.set(normalizedModel, this.encoder);
        return;
      } catch {
        // Fallback to cl100k_base
        encoderKey = 'cl100k_base';
      }
    }

    if (TokenCounter.ENCODER_CACHE.has(encoderKey)) {
      this.encoder = TokenCounter.ENCODER_CACHE.get(encoderKey)!;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.encoder = get_encoding(encoderKey as any);
      TokenCounter.ENCODER_CACHE.set(encoderKey, this.encoder);
    }
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
    // No-op: encoders are shared in a global cache and should not be freed
    // while other instances might still be using them.
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