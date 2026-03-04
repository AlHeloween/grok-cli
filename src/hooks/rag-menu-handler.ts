import { existsSync } from "fs";
import path from "path";
import { getInstallationRoot } from "../utils/path-utils.js";
import type { SettingsManager } from "../utils/settings-manager.js";
import type { ChatEntry } from "../agent/grok-agent.js";

import { VectorDb } from "../rag/vector-db.js";
import { indexProject } from "../rag/indexer.js";
import {
  exportVectorDbToMakerAiJson as _exportVectorDbToMakerAiJson,
  importMakerAiJsonToVectorDb as _importMakerAiJsonToVectorDb,
} from "../rag/makerai.js";
import { createEmbeddingClientFromSettings } from "../rag/embedding-client.js";

export interface ConfigMenuItem {
  id: string;
  label: string;
  hint?: string;
}

export interface RagHandlerDependencies {
  setChatHistory: (updater: (prev: ChatEntry[]) => ChatEntry[]) => void;
  getSettingsManager: () => SettingsManager;
  ragListOffset: number;
  setRagListOffset: (offset: number) => void;
  setRagInputAction: (action: string | null) => void;
  setRagInputPrompt: (prompt: string | null) => void;
  clearInput: () => void;
}

export function getRagMenuItems(): ConfigMenuItem[] {
  return [
    { id: "rag:list", label: "List chunks", hint: "Browse indexed chunks with pagination" },
    { id: "rag:search", label: "Search chunks", hint: "Semantic search across indexed content" },
    { id: "rag:delete", label: "Delete chunks", hint: "Remove chunks by path or pattern" },
    { id: "rag:index", label: "Index project", hint: "Index current project into .grok/rag.db" },
    { id: "rag:status", label: "Status", hint: "Show RAG status and statistics" },
    { id: "rag:export", label: "Export MakerAI", hint: "Export .grok/rag.db to MakerAI JSON format" },
    { id: "rag:import", label: "Import MakerAI", hint: "Import MakerAI JSON into .grok/rag.db" },
    { id: "rag:gui", label: "Open GUI", hint: "Open MakerAI-based GUI to browse/edit RAG" },
    { id: "action:ragHelp", label: "RAG help (CLI commands)" },
  ];
}

export function createRagHandler(deps: RagHandlerDependencies) {
  const { setChatHistory, ragListOffset, setRagListOffset, setRagInputAction, setRagInputPrompt, clearInput } = deps;
  const getSettingsManager = deps.getSettingsManager;

  const push = (content: string) =>
    setChatHistory((prev: ChatEntry[]) => [...prev, { type: "assistant", content, timestamp: new Date() }]);

  const beginRagInput = (action: string, prompt: string): void => {
    setRagInputAction(action);
    setRagInputPrompt(prompt);
    clearInput();
  };

  const handleRagAction = async (action: string): Promise<void> => {
    try {
      switch (action) {
        case "status": {
          const manager = getSettingsManager();
          const enabled = manager.isRagEnabled();
          const topK = manager.getRagTopK();
          const extractor = manager.getRagExtractor();
          const python = manager.getRagPython();
          const dbPath = manager.getRagDbPath();
          let chunks = 0;
          if (existsSync(dbPath)) {
            try {
              const db = await VectorDb.open(dbPath);
              chunks = db.getChunkCount();
              db.close();
            } catch {
              // ignore
            }
          }
          push(`RAG enabled: ${enabled ? "yes" : "no"}\nRAG topK: ${topK}\nRAG extractor: ${extractor}${extractor === "sqlite-rag" ? `\nRAG python: ${python || "(auto-detect)"}` : ""}\nRAG db: ${dbPath}\nIndexed chunks: ${chunks}`);
          break;
        }
        case "index": {
          push("Starting RAG indexing...");
          const result = await indexProject({});
          push(`✅ RAG index written to ${result.dbPath}\n✅ Files indexed: ${result.filesIndexed}\n✅ Chunks indexed: ${result.chunksIndexed}`);
          break;
        }
        case "list": {
          const manager = getSettingsManager();
          const dbPath = manager.getRagDbPath();
          if (!existsSync(dbPath)) {
            push("No RAG index found. Run 'Index project' first.");
            break;
          }
          const db = await VectorDb.open(dbPath);
          const rows = db.listChunkRows(10, ragListOffset);
          db.close();
          if (rows.length === 0) {
            push(ragListOffset === 0 ? "No chunks found in index." : "No more chunks.");
            setRagListOffset(0);
          } else {
            const list = rows.map((r, i) => `${ragListOffset + i + 1}. [${r.id}] ${r.path}: ${r.text.slice(0, 80)}...`).join('\n');
            push(`Chunks ${ragListOffset + 1} to ${ragListOffset + rows.length}:\n${list}\n\nUse 'list' again for next page.`);
            setRagListOffset(ragListOffset + rows.length);
          }
          break;
        }
        case "search":
          beginRagInput("search", "Enter search query:");
          break;
        case "delete":
          beginRagInput("delete", "Enter file path or pattern to delete (use '*' for all):");
          break;
        case "export": {
          const manager = getSettingsManager();
          const dbPath = manager.getRagDbPath();
          if (!existsSync(dbPath)) {
            push("No RAG index found. Run 'Index project' first.");
            break;
          }
          push("Exporting to MakerAI JSON...");
          try {
            const result = await _exportVectorDbToMakerAiJson({
              dbPath,
              outFile: "makerai-ragvector.json",
              name: path.basename(process.cwd()),
              description: "",
              model: "",
            });
            push(`✅ Exported ${result.chunks} chunk(s) to ${result.outFile}`);
          } catch (err) {
            push(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
        case "import":
          beginRagInput("import", "Enter path to MakerAI JSON file:");
          break;
        case "gui": {
          push("Opening RAG GUI...");
          const manager = getSettingsManager();
          const dbPath = manager.getRagDbPath();
          const exePath = path.resolve(getInstallationRoot(), "MakerAI", "_build", "win64", "bin", "RagManager.exe");
          console.error('[rag-menu-handler] exePath:', exePath);
          const displayExePath = exePath.replace(/\\/g, '/');
          if (!existsSync(exePath)) {
            const scriptPath = path.resolve(getInstallationRoot(), "scripts", "build-makerai.ps1");
            push(`❌ RagManager.exe not found at: ${displayExePath}`);
            if (existsSync(scriptPath)) {
              push(`Build it with: powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`);
            } else {
              push("Build it with: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-makerai.ps1");
              push(`Script expected at: ${scriptPath}`);
            }
            break;
          }
          // In interactive CLI, we cannot spawn GUI directly; guide user
          const manualCommand = `Run command: grok rag gui\nor manually: ${displayExePath} --json .grok/makerai-ragvector.json --db ${dbPath}`;
          console.error('[rag-menu-handler] manualCommand:', manualCommand);
          push(manualCommand);
          break;
        }
        default:
          push(`Unknown RAG action: ${action}`);
      }
    } catch (err) {
      push(`Error performing RAG action: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const processRagInput = async (action: string, userInput: string): Promise<void> => {
    const input = userInput.trim();

    try {
      switch (action) {
        case "search": {
          if (!input) {
            push("Search cancelled.");
            break;
          }
          push(`Searching for: "${input}"...`);
          const manager = getSettingsManager();
          const dbPath = manager.getRagDbPath();
          if (!existsSync(dbPath)) {
            push("No RAG index found. Run 'Index project' first.");
            break;
          }
          const embeddingClient = createEmbeddingClientFromSettings();
          const vector = await embeddingClient.embed(input);
          const db = await VectorDb.open(dbPath);
          const results = db.queryTopK(vector, manager.getRagTopK());
          db.close();
          if (results.length === 0) {
            push("No results found.");
          } else {
            const list = results.map((r, i) => `${i + 1}. [${r.id}] ${r.path} (dist: ${r.distance?.toFixed(4)})\n   ${r.text.slice(0, 120)}...`).join('\n\n');
            push(`Top ${results.length} results:\n${list}`);
          }
          break;
        }
        case "delete": {
          if (!input) {
            push("Delete cancelled.");
            break;
          }
          if (input === "*") {
            push("Clearing all chunks...");
            const manager = getSettingsManager();
            const dbPath = manager.getRagDbPath();
            if (!existsSync(dbPath)) {
              push("No RAG index found.");
              break;
            }
            const db = await VectorDb.open(dbPath);
            db.clearAllChunks();
            db.close();
            push("✅ All chunks deleted.");
          } else {
            push(`Deleting chunks matching: ${input}...`);
            const manager = getSettingsManager();
            const dbPath = manager.getRagDbPath();
            if (!existsSync(dbPath)) {
              push("No RAG index found.");
              break;
            }
            const db = await VectorDb.open(dbPath);
            // Simple path matching (exact match for now)
            db.deleteChunksByPath(input);
            db.close();
            push(`✅ Deleted chunks with path: ${input}`);
          }
          break;
        }
        case "import": {
          if (!input) {
            push("Import cancelled.");
            break;
          }
          const filePath = path.resolve(process.cwd(), input);
          if (!existsSync(filePath)) {
            push(`File not found: ${filePath}`);
            break;
          }
          push(`Importing ${filePath}...`);
          const manager = getSettingsManager();
          const dbPath = manager.getRagDbPath();
          try {
            const result = await _importMakerAiJsonToVectorDb({
              inFile: filePath,
              dbPath,
              replace: false,
            });
            push(`✅ Imported ${result.inserted} chunk(s) into ${result.dbPath}`);
          } catch (err) {
            push(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
        default:
          push(`Unknown RAG input action: ${action}`);
      }
    } catch (err) {
      push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    handleRagAction,
    beginRagInput,
    processRagInput,
  };
}
