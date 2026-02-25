import { get_encoding, encoding_for_model, Tiktoken } from 'tiktoken';

export class TokenCounter {
  private encoder: Tiktoken;
  private cache: Map<string, number> = new Map();
  private static readonly MAX_CACHE_SIZE = 1000;

  constructor(model: string = 'gpt-4') {
    if (model && model.toLowerCase().includes('grok')) {
      // Grok model names are not mapped by tiktoken; use a stable fallback encoding.
      this.encoder = get_encoding('cl100k_base');
      return;
    }

    try {
      // Try to get encoding for specific model
      this.encoder = encoding_for_model(model as any);
    } catch {
      // Fallback to cl100k_base (used by GPT-4 and most modern models)
      this.encoder = get_encoding('cl100k_base');
    }
  }

  /**
   * Count tokens in a string
   */
  countTokens(text: string): number {
    if (!text) return 0;

    // Don't cache very large strings to avoid memory bloat
    if (text.length > 2000) {
      return this.encoder.encode(text).length;
    }

    const cached = this.cache.get(text);
    if (cached !== undefined) {
      return cached;
    }

    const count = this.encoder.encode(text).length;

    // Basic LRU-like eviction: clear if it gets too big
    if (this.cache.size >= TokenCounter.MAX_CACHE_SIZE) {
      this.cache.clear();
    }

    this.cache.set(text, count);
    return count;
  }

  /**
   * Count tokens in messages array (for chat completions)
   */
  countMessageTokens(messages: Array<{ role: string; content: string | null; [key: string]: any }>): number {
    let totalTokens = 0;
    
    for (const message of messages) {
      // Every message follows <|start|>{role/name}\n{content}<|end|\>\n
      totalTokens += 3; // Base tokens per message
      
      if (message.content && typeof message.content === 'string') {
        totalTokens += this.countTokens(message.content);
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
    this.encoder.free();
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