import OpenAI from "openai";
import { getSettingsManager } from "../utils/settings-manager.js";

export interface EmbeddingClientOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
}

export class EmbeddingClient {
  private client: OpenAI;
  private model: string;

  constructor(options: EmbeddingClientOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs ?? 120_000,
    });
  }

  getModel(): string {
    return this.model;
  }

  async embed(text: string): Promise<number[]> {
    const input = text.trim();
    if (!input) return [];

    const response = await this.client.embeddings.create({
      model: this.model,
      input,
    });

    const vector = response.data?.[0]?.embedding;
    if (!Array.isArray(vector)) {
      throw new Error("Embeddings API returned no vector");
    }
    return vector as number[];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const inputs = texts.map((t) => t.trim()).filter(Boolean);
    if (inputs.length === 0) return [];

    const response = await this.client.embeddings.create({
      model: this.model,
      input: inputs,
    });

    const vectors = (response.data || []).map((d) => d.embedding);
    if (!vectors.every((v) => Array.isArray(v))) {
      throw new Error("Embeddings API returned invalid vectors");
    }
    return vectors as number[][];
  }
}

export function createEmbeddingClientFromSettings(): EmbeddingClient {
  const settings = getSettingsManager();
  const apiKey = settings.getApiKey();
  if (!apiKey) {
    throw new Error("Missing API key (set GROK_API_KEY or ~/.grok/user-settings.json)");
  }

  const embeddings = settings.getEmbeddingsSettings(process.cwd());

  return new EmbeddingClient({
    apiKey,
    baseURL: embeddings.baseURL || settings.getBaseURL(),
    model: embeddings.model || "text-embedding-3-small",
  });
}

