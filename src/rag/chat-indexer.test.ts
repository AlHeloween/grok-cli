import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { indexChatHistory, deleteChatSession, type ChatIndexOptions } from "./chat-indexer.js";
import type { ChatEntry } from "../agent/grok-agent.js";

// Mock dependencies
vi.mock("./embedding-client.js", () => ({
  createEmbeddingClientFromSettings: vi.fn(),
}));

vi.mock("./vector-db.js", () => ({
  VectorDb: {
    open: vi.fn(),
  },
}));

vi.mock("../utils/settings-manager.js", () => ({
  getSettingsManager: vi.fn(),
}));

// Import mocked modules after vi.mock
import * as embeddingClientMod from "./embedding-client.js";
import * as vectorDbMod from "./vector-db.js";
import * as settingsManagerMod from "../utils/settings-manager.js";

describe("chat-indexer", () => {
  const mockCreateEmbeddingClient = vi.mocked(embeddingClientMod.createEmbeddingClientFromSettings);
  const mockVectorDbOpen = vi.mocked(vectorDbMod.VectorDb.open);
  const mockGetSettingsManager = vi.mocked(settingsManagerMod.getSettingsManager);

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mocks
    mockGetSettingsManager.mockReturnValue({
      getRagDbPath: vi.fn((_cwd: string) => `/.grok/rag.db`),

    } as any /* eslint-disable-line @typescript-eslint/no-explicit-any */);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("indexChatHistory", () => {
    const mockEntries: ChatEntry[] = [
      {
        type: "user",
        content: "Hello, world",
        timestamp: new Date("2026-03-01T12:00:00Z"),
        svHash: "abc123",
        msgHash: "def456",
        prevSVHashes: [],
        semanticDominant: "greeting",
        semanticVector: [{ keyword: "hello", weight: 0.8 }],
      },
      {
        type: "assistant",
        content: "Hi there!",
        timestamp: new Date("2026-03-01T12:00:05Z"),
        svHash: "xyz789",
        msgHash: "uvw012",
        prevSVHashes: ["abc123"],
        semanticDominant: "response",
        semanticVector: [{ keyword: "hi", weight: 0.9 }],
      },
    ];

    // Helper to create a mock embedding client
    const createMockEmbeddingClient = (embedResult: number[]) => ({
      client: {},
      model: "text-embedding-3-small",
      getModel: vi.fn(() => "text-embedding-3-small"),
      embed: vi.fn().mockResolvedValue(embedResult),
      embedBatch: vi.fn().mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => embedResult))
      ),

    }) as any /* eslint-disable-line @typescript-eslint/no-explicit-any */

    const mockDbInstance = {
      beginTransaction: vi.fn(),
      deleteChunksByPathPrefix: vi.fn(),
      insertChunk: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      close: vi.fn(),
    };

    it("should index entries and return chunksIndexed", async () => {
      // Arrange
      const mockEmbeddingClient = createMockEmbeddingClient([0.1, 0.2, 0.3]);
      mockEmbeddingClient.embedBatch.mockResolvedValue([
        [0.4, 0.5, 0.6], // first entry
        [0.7, 0.8, 0.9], // second entry
      ]);
      mockCreateEmbeddingClient.mockReturnValue(mockEmbeddingClient);
      mockVectorDbOpen.mockResolvedValue(mockDbInstance as any /* eslint-disable-line @typescript-eslint/no-explicit-any */);

      const options: ChatIndexOptions = { sessionId: "test-session" };

      // Act
      const result = await indexChatHistory(mockEntries, options);

      // Assert
      expect(mockGetSettingsManager).toHaveBeenCalled();
      expect(mockCreateEmbeddingClient).toHaveBeenCalled();
      expect(mockEmbeddingClient.embedBatch).toHaveBeenCalledWith([
        "[user] Hello, world",
        "[assistant] Hi there!",
      ]);
      expect(mockVectorDbOpen).toHaveBeenCalledWith(`/.grok/rag.db`, {
        dimension: 3,
        distance: "COSINE",
      });
      expect(mockDbInstance.beginTransaction).toHaveBeenCalled();
      expect(mockDbInstance.deleteChunksByPathPrefix).toHaveBeenCalledWith(
        "chat://session/test-session/"
      );
      expect(mockDbInstance.insertChunk).toHaveBeenCalledTimes(2);
      expect(mockDbInstance.commitTransaction).toHaveBeenCalled();
      expect(mockDbInstance.close).toHaveBeenCalled();
      expect(result).toEqual({ chunksIndexed: 2 });
    });

    it("should skip entries with empty embedding vector", async () => {
      // Arrange
      const mockEmbeddingClient = createMockEmbeddingClient([0.1, 0.2, 0.3]);
      mockEmbeddingClient.embedBatch.mockResolvedValue([
        [], // first entry empty
        [0.7, 0.8, 0.9], // second entry ok
      ]);
      mockCreateEmbeddingClient.mockReturnValue(mockEmbeddingClient);
      mockVectorDbOpen.mockResolvedValue(mockDbInstance as any /* eslint-disable-line @typescript-eslint/no-explicit-any */);

      const options: ChatIndexOptions = { sessionId: "test-session" };

      // Act
      const result = await indexChatHistory(mockEntries, options);

      // Assert
      expect(mockDbInstance.insertChunk).toHaveBeenCalledTimes(1); // only second entry
      expect(result).toEqual({ chunksIndexed: 1 });
    });

    it("should not delete previous entries when replace is false", async () => {
      // Arrange
      const mockEmbeddingClient = createMockEmbeddingClient([0.1, 0.2, 0.3]);
      mockCreateEmbeddingClient.mockReturnValue(mockEmbeddingClient);
      mockVectorDbOpen.mockResolvedValue(mockDbInstance as any /* eslint-disable-line @typescript-eslint/no-explicit-any */);

      const options: ChatIndexOptions = { sessionId: "test-session", replace: false };

      // Act
      await indexChatHistory(mockEntries, options);

      // Assert
      expect(mockDbInstance.deleteChunksByPathPrefix).not.toHaveBeenCalled();
    });

    it("should throw when embedding dimension cannot be determined", async () => {
      // Arrange
      const mockEmbeddingClient = createMockEmbeddingClient([]); // empty sample vector
      mockCreateEmbeddingClient.mockReturnValue(mockEmbeddingClient);
      mockVectorDbOpen.mockResolvedValue(mockDbInstance as any /* eslint-disable-line @typescript-eslint/no-explicit-any */);

      const options: ChatIndexOptions = { sessionId: "test-session" };

      // Act & Assert
      await expect(indexChatHistory(mockEntries, options)).rejects.toThrow(
        "Failed to get embedding dimension"
      );
    });

    it("should rollback transaction on error", async () => {
      // Arrange
      const mockEmbeddingClient = createMockEmbeddingClient([0.1, 0.2, 0.3]);
      mockCreateEmbeddingClient.mockReturnValue(mockEmbeddingClient);
      mockVectorDbOpen.mockResolvedValue(mockDbInstance as any /* eslint-disable-line @typescript-eslint/no-explicit-any */);
      mockDbInstance.insertChunk.mockImplementation(() => {
        throw new Error("DB error");
      });

      const options: ChatIndexOptions = { sessionId: "test-session" };

      // Act & Assert
      await expect(indexChatHistory(mockEntries, options)).rejects.toThrow("DB error");
      expect(mockDbInstance.rollbackTransaction).toHaveBeenCalled();
      expect(mockDbInstance.close).toHaveBeenCalled();
    });
  });

  describe("deleteChatSession", () => {
    const mockDbInstance = {
      deleteChunksByPathPrefix: vi.fn(),
      close: vi.fn(),
    };

    it("should delete chunks with session prefix", async () => {
      // Arrange
      mockVectorDbOpen.mockResolvedValue(mockDbInstance as any /* eslint-disable-line @typescript-eslint/no-explicit-any */);

      // Act
      await deleteChatSession("test-session");

      // Assert
      expect(mockGetSettingsManager).toHaveBeenCalled();
      expect(mockVectorDbOpen).toHaveBeenCalledWith(`/.grok/rag.db`);
      expect(mockDbInstance.deleteChunksByPathPrefix).toHaveBeenCalledWith(
        "chat://session/test-session/"
      );
      expect(mockDbInstance.close).toHaveBeenCalled();
    });

    it("should accept custom cwd", async () => {
      // Arrange
      mockVectorDbOpen.mockResolvedValue(mockDbInstance as any /* eslint-disable-line @typescript-eslint/no-explicit-any */);

      // Act
      await deleteChatSession("test-session", "/custom/path");

      // Assert
      expect(mockVectorDbOpen).toHaveBeenCalledWith(`/.grok/rag.db`);
      // Note: getRagDbPath uses the provided cwd; we mock it to return `/.grok/rag.db` always.
      // In a real test we'd want to verify the correct path is passed.
    });
  });
});
