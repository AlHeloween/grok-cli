import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { indexProject } from "./indexer.js";
import { createEmbeddingClientFromSettings } from "./embedding-client.js";
import { getSettingsManager } from "../utils/settings-manager.js";

vi.mock("./embedding-client.js");
vi.mock("../utils/settings-manager.js");

describe("indexer optimization", () => {
  const mockEmbedBatch = vi.fn();
  const mockEmbed = vi.fn();
  const tempDir = path.join(os.tmpdir(), `grok-cli-test-${Date.now()}`);

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    vi.mocked(getSettingsManager).mockReturnValue({
      getRagDbPath: (cwd: string) => path.join(cwd, ".grok", "rag.db"),
      getRagExtractor: () => "native",
      getRagPython: () => undefined,
      getApiKey: () => "test-key",
      getBaseURL: () => "https://test.api",
      getEmbeddingsSettings: () => ({ model: "test-model" }),
    } as unknown as any);

    vi.mocked(createEmbeddingClientFromSettings).mockReturnValue({
      embedBatch: mockEmbedBatch,
      embed: mockEmbed,
      getModel: () => "test-model",
    } as unknown as any);

    // 1536 is a common embedding dimension (e.g. OpenAI)
    const dummyVector = new Array(1536).fill(0.1);
    mockEmbed.mockResolvedValue(dummyVector);
    mockEmbedBatch.mockImplementation(async (texts: string[]) => {
      return texts.map(() => dummyVector);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("batches embeddings across multiple small files", async () => {
    fs.writeFileSync(path.join(tempDir, "f1.ts"), "content 1");
    fs.writeFileSync(path.join(tempDir, "f2.ts"), "content 2");
    fs.writeFileSync(path.join(tempDir, "f3.ts"), "content 3");

    const result = await indexProject({
      cwd: tempDir,
      batchSize: 10,
    });

    expect(result.filesIndexed).toBe(3);

    // 1. embed() should be called once to determine dimension (from f1.ts)
    // 2. embedBatch() should be called once for all 3 files because batchSize=10
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockEmbedBatch).toHaveBeenCalledTimes(1);

    const batchArgs = mockEmbedBatch.mock.calls[0][0];
    expect(batchArgs).toHaveLength(3);
    expect(batchArgs).toContain("content 1");
    expect(batchArgs).toContain("content 2");
    expect(batchArgs).toContain("content 3");
  });

  it("flushes the buffer when batchSize is reached", async () => {
    // 3 files, each with 1 chunk, batchSize = 2
    fs.writeFileSync(path.join(tempDir, "f1.ts"), "content 1");
    fs.writeFileSync(path.join(tempDir, "f2.ts"), "content 2");
    fs.writeFileSync(path.join(tempDir, "f3.ts"), "content 3");

    await indexProject({
      cwd: tempDir,
      batchSize: 2,
    });

    // 1. embed() for dimension
    // 2. embedBatch() for [f1, f2]
    // 3. embedBatch() for [f3]
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockEmbedBatch).toHaveBeenCalledTimes(2);

    expect(mockEmbedBatch.mock.calls[0][0]).toHaveLength(2);
    expect(mockEmbedBatch.mock.calls[1][0]).toHaveLength(1);
  });
});
