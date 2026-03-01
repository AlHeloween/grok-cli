import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retrieveTopK, formatRagChunksForPrompt } from "./retriever.js";
import type { RagChunkRow } from "./vector-db.js";

// Mock dependencies
vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("./embedding-client.js", () => ({
  createEmbeddingClientFromSettings: vi.fn(() => ({
    client: {},
    model: "text-embedding-3-small",
    getModel: vi.fn(() => "text-embedding-3-small"),
    embed: vi.fn(),
    embedBatch: vi.fn(),
  })),
}));

vi.mock("./vector-db.js", () => ({
  VectorDb: {
    open: vi.fn(),
  },
}));

vi.mock("../utils/settings-manager.js", () => ({
  getSettingsManager: vi.fn(() => ({
    getRagDbPath: vi.fn((_cwd: string) => `/.grok/rag.db`),
    getRagTopK: vi.fn((_cwd: string) => 10),
    getRagUseKMedoids: vi.fn((_cwd: string) => false),
    getRagCandidateCount: vi.fn((_cwd: string) => 100),
    getEmbeddingsSettings: vi.fn((_cwd: string) => ({
      apiKey: "test-key",
      baseURL: "https://api.test.com",
      model: "text-embedding-3-small",
    })),
    getApiKey: vi.fn(() => "test-key"),
    getBaseURL: vi.fn(() => "https://api.test.com"),
  })),
}));

vi.mock("./k-medoids.js", () => ({
  selectKMedoids: vi.fn(),
}));

// Import mocked modules after vi.mock
import * as fsMod from "fs";
import * as embeddingClientMod from "./embedding-client.js";
import * as vectorDbMod from "./vector-db.js";
import * as settingsManagerMod from "../utils/settings-manager.js";
import * as kMedoidsMod from "./k-medoids.js";

describe("formatRagChunksForPrompt", () => {
  it("formats empty array", () => {
    expect(formatRagChunksForPrompt([])).toBe("");
  });

  it("formats single chunk", () => {
    const rows: RagChunkRow[] = [
      {
        id: 1,
        path: "/test/file.ts",
        text: "console.log('hello')",
        meta: "typescript",
        distance: 0.1234,
      },
    ];
    const result = formatRagChunksForPrompt(rows);
    expect(result).toContain("PATH: /test/file.ts");
    expect(result).toContain("META: typescript");
    expect(result).toContain("DISTANCE: 0.1234");
    expect(result).toContain("console.log('hello')");
  });

  it("respects maxChars limit", () => {
    const rows: RagChunkRow[] = [
      {
        id: 1,
        path: "a.txt",
        text: "x".repeat(100),
        meta: "",
        distance: 0,
      },
      {
        id: 2,
        path: "b.txt",
        text: "y".repeat(100),
        meta: "",
        distance: 0,
      },
    ];
    // Set maxChars low enough that only first chunk fits
    const result = formatRagChunksForPrompt(rows, 160);
    expect(result).toContain("a.txt");
    expect(result).not.toContain("b.txt");
  });
});

describe("retrieveTopK", () => {
  const mockExistsSync = vi.mocked(fsMod.existsSync);
  const mockCreateEmbeddingClient = vi.mocked(embeddingClientMod.createEmbeddingClientFromSettings);
  const mockVectorDbOpen = vi.mocked(vectorDbMod.VectorDb.open);
  const mockGetSettingsManager = vi.mocked(settingsManagerMod.getSettingsManager);
  const mockSelectKMedoids = vi.mocked(kMedoidsMod.selectKMedoids);

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mocks
    mockGetSettingsManager.mockReturnValue({
      getRagDbPath: vi.fn((_cwd: string) => `/.grok/rag.db`),
      getRagTopK: vi.fn((_cwd: string) => 10),
      getRagUseKMedoids: vi.fn((_cwd: string) => false),
      getRagCandidateCount: vi.fn((_cwd: string) => 100),
      getEmbeddingsSettings: vi.fn((_cwd: string) => ({
        apiKey: "test-key",
        baseURL: "https://api.test.com",
        model: "text-embedding-3-small",
      })),
      getApiKey: vi.fn(() => "test-key"),
      getBaseURL: vi.fn(() => "https://api.test.com"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty array when DB does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await retrieveTopK("query");
    expect(result).toEqual([]);
    expect(mockExistsSync).toHaveBeenCalledTimes(1);
  });

  // Helper to create a mock embedding client
  const createMockEmbeddingClient = (embedResult: number[]) => ({
    client: {},
    model: "text-embedding-3-small",
    getModel: vi.fn(() => "text-embedding-3-small"),
    embed: vi.fn().mockResolvedValue(embedResult),
    embedBatch: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  it("returns empty array when embedding vector is empty", async () => {
    mockExistsSync.mockReturnValue(true);
    mockCreateEmbeddingClient.mockReturnValue(createMockEmbeddingClient([]));
    const result = await retrieveTopK("query");
    expect(result).toEqual([]);
  });

  it("queries DB with k when k-medoids disabled", async () => {
    mockExistsSync.mockReturnValue(true);
    mockCreateEmbeddingClient.mockReturnValue(createMockEmbeddingClient([0.1, 0.2, 0.3]));
    const mockDbInstance = {
      queryTopK: vi.fn().mockReturnValue([{ id: 1, text: "chunk1" }]),
      queryTopN: vi.fn().mockReturnValue([{ id: 1, text: "chunk1" }]),
      queryTopKWithPrefix: vi.fn().mockReturnValue([]),
      deleteChunksByPathPrefix: vi.fn(),
      getChunkVectorsByIds: vi.fn(),
      getDistanceMetric: vi.fn(),
      close: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockVectorDbOpen.mockResolvedValue(mockDbInstance as any);

    const result = await retrieveTopK("query", { useKMedoids: false });
    expect(mockDbInstance.queryTopKWithPrefix).toHaveBeenCalledWith([0.1, 0.2, 0.3], 10, "chat://");
    expect(mockDbInstance.queryTopN).toHaveBeenCalledWith([0.1, 0.2, 0.3], 10);
    expect(mockDbInstance.close).toHaveBeenCalled();
    expect(result).toEqual([{ id: 1, text: "chunk1" }]);
  });

  it("uses k-medoids when enabled", async () => {
    mockExistsSync.mockReturnValue(true);
    mockCreateEmbeddingClient.mockReturnValue(createMockEmbeddingClient([0.1, 0.2, 0.3]));
    const mockDbInstance = {
      queryTopK: vi.fn(),
      queryTopN: vi.fn().mockReturnValue([
        { id: 1, distance: 0.5 },
        { id: 2, distance: 0.6 },
        { id: 3, distance: 0.7 },
      ]),
      queryTopKWithPrefix: vi.fn().mockReturnValue([]),
      deleteChunksByPathPrefix: vi.fn(),
      getChunkVectorsByIds: vi.fn().mockReturnValue(new Map([
        [1, new Float32Array([0.1, 0.2, 0.3])],
        [2, new Float32Array([0.4, 0.5, 0.6])],
        [3, new Float32Array([0.7, 0.8, 0.9])],
      ])),
      getDistanceMetric: vi.fn().mockReturnValue("L2"),
      close: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockVectorDbOpen.mockResolvedValue(mockDbInstance as any);
    mockSelectKMedoids.mockReturnValue([0, 1]); // select first two as medoids

    const result = await retrieveTopK("query", { useKMedoids: true, topK: 2, candidateCount: 10 });
    expect(mockDbInstance.queryTopN).toHaveBeenCalledWith([0.1, 0.2, 0.3], 10);
    expect(mockSelectKMedoids).toHaveBeenCalled();
    expect(mockDbInstance.close).toHaveBeenCalled();
    // Should return selected rows sorted by distance
    expect(result).toEqual([{ id: 1, distance: 0.5 }, { id: 2, distance: 0.6 }]);
  });

  it("searches chat first when searchChatFirst is true", async () => {
    mockExistsSync.mockReturnValue(true);
    mockCreateEmbeddingClient.mockReturnValue(createMockEmbeddingClient([0.1, 0.2, 0.3]));
    // Override settings to enable chat search
    mockGetSettingsManager.mockReturnValue({
      getRagDbPath: vi.fn((_cwd: string) => `/.grok/rag.db`),
      getRagTopK: vi.fn((_cwd: string) => 10),
      getRagUseKMedoids: vi.fn((_cwd: string) => false),
      getRagCandidateCount: vi.fn((_cwd: string) => 100),
      getRagSearchChatFirst: vi.fn((_cwd: string) => true),
      getRagChatPrefix: vi.fn((_cwd: string) => "chat://"),
      getEmbeddingsSettings: vi.fn((_cwd: string) => ({
        apiKey: "test-key",
        baseURL: "https://api.test.com",
        model: "text-embedding-3-small",
      })),
      getApiKey: vi.fn(() => "test-key"),
      getBaseURL: vi.fn(() => "https://api.test.com"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const mockDbInstance = {
      queryTopK: vi.fn(),
      queryTopN: vi.fn().mockReturnValue([
        { id: 1, path: "file.txt", text: "file content", distance: 0.5 },
        { id: 2, path: "another.txt", text: "another file", distance: 0.6 },
      ]),
      queryTopKWithPrefix: vi.fn().mockReturnValue([
        { id: 10, path: "chat://session/abc/0", text: "chat message", distance: 0.3 },
        { id: 11, path: "chat://session/abc/1", text: "another chat", distance: 0.4 },
      ]),
      deleteChunksByPathPrefix: vi.fn(),
      getChunkVectorsByIds: vi.fn(),
      getDistanceMetric: vi.fn(),
      close: vi.fn(),
    };
    mockVectorDbOpen.mockResolvedValue(mockDbInstance as any);

    const result = await retrieveTopK("query", { searchChatFirst: true });
    expect(mockDbInstance.queryTopKWithPrefix).toHaveBeenCalledWith([0.1, 0.2, 0.3], 10, "chat://");
    expect(mockDbInstance.queryTopN).toHaveBeenCalledWith([0.1, 0.2, 0.3], 8);
    expect(mockDbInstance.close).toHaveBeenCalled();
    // Should return combined results, deduplicated, sorted by distance
    expect(result).toEqual([
      { id: 10, path: "chat://session/abc/0", text: "chat message", distance: 0.3 },
      { id: 11, path: "chat://session/abc/1", text: "another chat", distance: 0.4 },
      { id: 1, path: "file.txt", text: "file content", distance: 0.5 },
      { id: 2, path: "another.txt", text: "another file", distance: 0.6 },
    ]);
  });
});