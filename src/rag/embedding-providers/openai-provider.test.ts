import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAiEmbeddingProvider } from "./openai-provider.js";
import OpenAI from "openai";

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: vi.fn().mockImplementation(async ({ input }) => {
          return {
            data: (Array.isArray(input) ? input : [input]).map((text, i) => ({
              embedding: [i, i + 1],
              index: i,
            })),
          };
        }),
      },
    })),
  };
});

describe("OpenAiEmbeddingProvider.embedBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should maintain 1:1 mapping and handle empty strings", async () => {
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "test-key",
      baseURL: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
    });

    const inputs = ["hello", "", "  ", "world"];
    const vectors = await provider.embedBatch(inputs);

    expect(vectors).toHaveLength(4);
    expect(vectors[0]).toEqual([0, 1]);
    expect(vectors[1]).toEqual([]);
    expect(vectors[2]).toEqual([]);
    expect(vectors[3]).toEqual([1, 2]);

    // Check that only non-empty inputs were sent to the API
    const mockOpenAI = vi.mocked(OpenAI);
    const mockClient = mockOpenAI.mock.results[0].value;
    expect(mockClient.embeddings.create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: ["hello", "world"],
    });
  });

  it("should return all empty vectors if all inputs are empty", async () => {
    const provider = new OpenAiEmbeddingProvider({
      apiKey: "test-key",
      baseURL: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
    });

    const inputs = ["", "  "];
    const vectors = await provider.embedBatch(inputs);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toEqual([]);
    expect(vectors[1]).toEqual([]);

    const mockOpenAI = vi.mocked(OpenAI);
    const mockClient = mockOpenAI.mock.results[0].value;
    expect(mockClient.embeddings.create).not.toHaveBeenCalled();
  });
});
