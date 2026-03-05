import { describe, it, expect, vi } from "vitest";
import { createEmbeddingProvider } from "./embedding-factory.js";
import { GloveEmbeddingProvider } from "./embedding-providers/glove-provider.js";
import { HashEmbeddingProvider } from "./embedding-providers/hash-provider.js";
import { OpenAiEmbeddingProvider } from "./embedding-providers/openai-provider.js";

// Mock the loader to avoid real SQLite dependency
vi.mock("../../aurora/glove/sqlite-loader.js", () => ({
  createSqliteGloVeLoader: vi.fn(() => ({
    getDimension: () => 3,
    getVectorAsArray: (word: string) => word === "test" ? [1, 2, 3] : null,
  })),
}));

describe("createEmbeddingProvider", () => {
  it("should create GloVe provider with valid model path", () => {
    const provider = createEmbeddingProvider({
      provider: "glove",
      gloveModelPath: "data/glove/test.db",
    });
    expect(provider).toBeInstanceOf(GloveEmbeddingProvider);
    expect(provider.getName()).toContain("GloVe");
  });

  it("should throw error when gloveModelPath missing", () => {
    expect(() => createEmbeddingProvider({ provider: "glove" }))
      .toThrow("gloveModelPath is required for glove provider");
  });

  it("should create hash provider with default dimension", () => {
    const provider = createEmbeddingProvider({ provider: "hash" });
    expect(provider).toBeInstanceOf(HashEmbeddingProvider);
    expect(provider.getDimension()).toBe(256);
  });

  it("should create hash provider with custom dimension", () => {
    const provider = createEmbeddingProvider({ provider: "hash", hashDimension: 512 });
    expect(provider).toBeInstanceOf(HashEmbeddingProvider);
    expect(provider.getDimension()).toBe(512);
  });

  it("should create OpenAI provider with required options", () => {
    const provider = createEmbeddingProvider({
      provider: "openai",
      apiKey: "test-key",
      baseURL: "https://api.test.com",
      model: "text-embedding-3-small",
    });
    expect(provider).toBeInstanceOf(OpenAiEmbeddingProvider);
  });

  it("should throw error when OpenAI apiKey missing", () => {
    expect(() => createEmbeddingProvider({
      provider: "openai",
      baseURL: "https://api.test.com",
    })).toThrow("apiKey is required for openai provider");
  });

  it("should throw error when OpenAI baseURL missing", () => {
    expect(() => createEmbeddingProvider({
      provider: "openai",
      apiKey: "test-key",
    })).toThrow("baseURL is required for openai provider");
  });
});

describe("Embedding providers", () => {
  describe("GloveEmbeddingProvider", () => {
    it("should embed text using mock loader", async () => {
      const provider = new GloveEmbeddingProvider("data/glove/test.db");
      const embedding = await provider.embed("test");
      expect(embedding).toHaveLength(3);
      // Since mock returns [1,2,3] for word "test", average and normalize
      // We'll just check that it returns a vector
      expect(embedding.every(v => typeof v === "number")).toBe(true);
    });

    it("should return zero vector for unknown words", async () => {
      const provider = new GloveEmbeddingProvider("data/glove/test.db");
      const embedding = await provider.embed("unknownword");
      expect(embedding).toHaveLength(3);
      expect(embedding.every(v => v === 0)).toBe(true);
    });
  });

  describe("HashEmbeddingProvider", () => {
    it("should produce deterministic embeddings", async () => {
      const provider = new HashEmbeddingProvider(128);
      const emb1 = await provider.embed("hello world");
      const emb2 = await provider.embed("hello world");
      expect(emb1).toEqual(emb2);
      expect(emb1).toHaveLength(128);
    });

    it("should produce different embeddings for different texts", async () => {
      const provider = new HashEmbeddingProvider(128);
      const emb1 = await provider.embed("hello world");
      const emb2 = await provider.embed("goodbye world");
      expect(emb1).not.toEqual(emb2);
    });
  });
});