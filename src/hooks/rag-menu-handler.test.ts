import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { getRagMenuItems, createRagHandler } from "./rag-menu-handler.js";
import type { ChatEntry } from "../agent/grok-agent.js";

// Mock dependencies
vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("../rag/vector-db.js", () => ({
  VectorDb: {
    open: vi.fn(),
  },
}));

vi.mock("../rag/indexer.js", () => ({
  indexProject: vi.fn(),
}));

vi.mock("../rag/makerai.js", () => ({
  exportVectorDbToMakerAiJson: vi.fn(),
  importMakerAiJsonToVectorDb: vi.fn(),
}));

vi.mock("../rag/embedding-client.js", () => ({
  createEmbeddingClientFromSettings: vi.fn(() => ({
    embed: vi.fn(),
  })),
}));

vi.mock("../utils/settings-manager.js", () => ({
  getSettingsManager: vi.fn(() => ({
    isRagEnabled: vi.fn(),
    getRagTopK: vi.fn(),
    getRagExtractor: vi.fn(),
    getRagPython: vi.fn(),
    getRagDbPath: vi.fn(),
    getEmbeddingsSettings: vi.fn(),
    getRagQuantize: vi.fn(),
    getRagQuantizePreload: vi.fn(),
    getRagAuroraEnabled: vi.fn(),
    getRagAuroraFractalQuantization: vi.fn(),
    getRagAuroraDualQuaternionDistance: vi.fn(),
    getRagAuroraGloveKeywords: vi.fn(),
    getRagAuroraGloveModelPath: vi.fn(),
  })),
}));

// Import mocked modules after vi.mock
import * as fsMod from "fs";

describe("getRagMenuItems", () => {
  it("returns expected menu items", () => {
    const items = getRagMenuItems();
    expect(items).toHaveLength(9);
    expect(items[0]).toEqual({ id: "rag:list", label: "List chunks", hint: "Browse indexed chunks with pagination" });
    expect(items[8]).toEqual({ id: "action:ragHelp", label: "RAG help (CLI commands)" });
  });
});

describe("createRagHandler", () => {
  let mockSetChatHistory: Mock;
  let mockGetSettingsManager: Mock;
  let mockSetRagListOffset: Mock;
  let mockSetRagInputAction: Mock;
  let mockSetRagInputPrompt: Mock;
  let mockClearInput: Mock;
  let mockPush: Mock;

  beforeEach(() => {
    mockSetChatHistory = vi.fn();
    mockGetSettingsManager = vi.fn();
    mockSetRagListOffset = vi.fn();
    mockSetRagInputAction = vi.fn();
    mockSetRagInputPrompt = vi.fn();
    mockClearInput = vi.fn();
    mockPush = vi.fn();
    // Mock push implementation
    mockSetChatHistory.mockImplementation((updater: (prev: ChatEntry[]) => ChatEntry[]) => {
      const result = updater([]);
      mockPush(result[result.length - 1]?.content);
      return result;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns handler functions", () => {
    const handler = createRagHandler({
      setChatHistory: mockSetChatHistory,
      getSettingsManager: mockGetSettingsManager,
      ragListOffset: 0,
      setRagListOffset: mockSetRagListOffset,
      setRagInputAction: mockSetRagInputAction,
      setRagInputPrompt: mockSetRagInputPrompt,
      clearInput: mockClearInput,
    });
    expect(handler).toHaveProperty("handleRagAction");
    expect(handler).toHaveProperty("beginRagInput");
    expect(handler).toHaveProperty("processRagInput");
    expect(typeof handler.handleRagAction).toBe("function");
    expect(typeof handler.beginRagInput).toBe("function");
    expect(typeof handler.processRagInput).toBe("function");
  });

  describe("handleRagAction", () => {
    it("status action calls push with status info", async () => {
      const mockManager = {
        isRagEnabled: vi.fn().mockReturnValue(true),
        getRagTopK: vi.fn().mockReturnValue(10),
        getRagExtractor: vi.fn().mockReturnValue("sqlite-rag"),
        getRagPython: vi.fn().mockReturnValue("python3"),
        getRagDbPath: vi.fn().mockReturnValue("/test/.grok/rag.db"),
        getEmbeddingsSettings: vi.fn().mockReturnValue({
          provider: "hash",
          model: "text-embedding-3-small",
        }),
        getRagQuantize: vi.fn().mockReturnValue(false),
        getRagQuantizePreload: vi.fn().mockReturnValue(false),
        getRagAuroraEnabled: vi.fn().mockReturnValue(false),
        getRagAuroraFractalQuantization: vi.fn().mockReturnValue(false),
        getRagAuroraDualQuaternionDistance: vi.fn().mockReturnValue(false),
        getRagAuroraGloveKeywords: vi.fn().mockReturnValue(false),
        getRagAuroraGloveModelPath: vi.fn().mockReturnValue("data/glove/glove_50d.db"),
      };
      mockGetSettingsManager.mockReturnValue(mockManager);
      vi.mocked(fsMod.existsSync).mockReturnValue(false);

      const handler = createRagHandler({
        setChatHistory: mockSetChatHistory,
        getSettingsManager: mockGetSettingsManager,
        ragListOffset: 0,
        setRagListOffset: mockSetRagListOffset,
        setRagInputAction: mockSetRagInputAction,
        setRagInputPrompt: mockSetRagInputPrompt,
        clearInput: mockClearInput,
      });

      await handler.handleRagAction("status");
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("RAG enabled: yes"));
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("RAG topK: 10"));
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("RAG extractor: sqlite-rag"));
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("RAG python: python3"));
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("Indexed chunks: 0"));
    });

    it("list action when no db calls push with error", async () => {
      const mockManager = {
        getRagDbPath: vi.fn().mockReturnValue("/test/.grok/rag.db"),
      };
      mockGetSettingsManager.mockReturnValue(mockManager);
      vi.mocked(fsMod.existsSync).mockReturnValue(false);

      const handler = createRagHandler({
        setChatHistory: mockSetChatHistory,
        getSettingsManager: mockGetSettingsManager,
        ragListOffset: 0,
        setRagListOffset: mockSetRagListOffset,
        setRagInputAction: mockSetRagInputAction,
        setRagInputPrompt: mockSetRagInputPrompt,
        clearInput: mockClearInput,
      });

      await handler.handleRagAction("list");
      expect(mockPush).toHaveBeenCalledWith("No RAG index found. Run 'Index project' first.");
    });

    // Additional tests can be added for other actions (search, delete, export, import, gui)
    // but they require more complex mocking; we can skip for now.
  });

  describe("beginRagInput", () => {
    it("sets action and prompt and clears input", () => {
      const handler = createRagHandler({
        setChatHistory: mockSetChatHistory,
        getSettingsManager: mockGetSettingsManager,
        ragListOffset: 0,
        setRagListOffset: mockSetRagListOffset,
        setRagInputAction: mockSetRagInputAction,
        setRagInputPrompt: mockSetRagInputPrompt,
        clearInput: mockClearInput,
      });

      handler.beginRagInput("search", "Enter search query:");
      expect(mockSetRagInputAction).toHaveBeenCalledWith("search");
      expect(mockSetRagInputPrompt).toHaveBeenCalledWith("Enter search query:");
      expect(mockClearInput).toHaveBeenCalled();
    });
  });

  describe("processRagInput", () => {
    it("search action with empty input cancels", async () => {
      const handler = createRagHandler({
        setChatHistory: mockSetChatHistory,
        getSettingsManager: mockGetSettingsManager,
        ragListOffset: 0,
        setRagListOffset: mockSetRagListOffset,
        setRagInputAction: mockSetRagInputAction,
        setRagInputPrompt: mockSetRagInputPrompt,
        clearInput: mockClearInput,
      });

      await handler.processRagInput("search", "");
      expect(mockPush).toHaveBeenCalledWith("Search cancelled.");
    });

    // More tests can be added for search, delete, import with mocked db and embedding client
  });
});

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/hooks/rag-menu-handler.test.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-02-28T16:13:03.127454+00:00"
//   "new_hash": "523e7f2381614acf91b49f5bc4767392"
//   "goal_id": "rag_menu_handler_test"
//   "semantics": "Create unit tests for rag-menu-handler module"
//   "update_attrs": {"relative_path": "src/hooks/rag-menu-handler.test.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/hooks/rag-menu-handler.test.ts\""
// }
