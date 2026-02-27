import * as fs from "fs";
import * as path from "path";


import { createEmbeddingClientFromSettings } from "./embedding-client.js";
import { VectorDb } from "./vector-db.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { extractText } from "./extractors.js";

const DEBUG_RAG = process.env.GROK_DEBUG_RAG === "1";

function logRagDebug(...args: unknown[]) {
  if (DEBUG_RAG) {
    console.warn("[RAG DEBUG]", ...args);
  }
}

export interface RagIndexOptions {
  cwd?: string;
  force?: boolean;
  chunkLines?: number;
  overlapLines?: number;
  maxFileSizeBytes?: number;
  batchSize?: number;
  quantize?: boolean;
  quantizePreload?: boolean;
  includeExtensions?: string[];
  /** Text extractor used for indexing (default: from project settings). */
  extractor?: "native" | "sqlite-rag";
  /** Python command used by sqlite-rag extractor (default: from project settings / auto-detect). */
  python?: string;
}

export interface RagIndexResult {
  dbPath: string;
  filesIndexed: number;
  chunksIndexed: number;
}

const DEFAULT_EXTS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".cs",
  ".yaml",
  ".yml",
  ".toml",
  ".env",
  ".sh",
  ".ps1",
];

// Mirrors sqlite-rag FileReader.extensions (dot-prefixed).
const SQLITE_RAG_DEFAULT_EXTS = [
  ".c",
  ".cpp",
  ".css",
  ".csv",
  ".docx",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".kt",
  ".md",
  ".mdx",
  ".mjs",
  ".pdf",
  ".php",
  ".pptx",
  ".py",
  ".rb",
  ".rs",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".xlsx",
  ".yaml",
  ".yml",
];

function normalizeExtensions(exts: string[]): string[] {
  return exts.map((e) => (e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`));
}

function hasAllowedExtension(filePath: string, exts: string[]): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return exts.includes(ext);
}

function shouldSkipPath(relPath: string): boolean {
  const p = relPath.replaceAll("\\", "/");
  return (
    p.startsWith(".git/") ||
    p.startsWith("node_modules/") ||
    p.startsWith("dist/") ||
    p.startsWith("build/") ||
    p.startsWith(".grok/") ||
    p.includes("/.git/") ||
    p.includes("/node_modules/") ||
    p.includes("/dist/") ||
    p.includes("/build/")
  );
}

function loadRagIgnore(cwd: string): string[] {
  const ignorePath = path.join(cwd, ".grok", "ragignore");
  if (!fs.existsSync(ignorePath)) return [];
  try {
    const content = fs.readFileSync(ignorePath, "utf-8");
    return content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function matchesIgnore(relPath: string, ignoreRules: string[]): boolean {
  if (!ignoreRules.length) return false;
  const p = relPath.replaceAll("\\", "/");
  // v1: simple substring match (documented). Can be upgraded to glob semantics later.
  return ignoreRules.some((rule) => p.includes(rule));
}

async function walkFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
          logRagDebug("initial embedding test failed:", err);
          continue;
        }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full);
      if (shouldSkipPath(rel)) continue;
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        results.push(full);
      }
    }
  }
  return results;
}

function chunkByLines(
  text: string,
  chunkLines: number,
  overlapLines: number
): Array<{ text: string; meta: { startLine: number; endLine: number } }> {
  const lines = text.split(/\r?\n/);
  const chunks: Array<{ text: string; meta: { startLine: number; endLine: number } }> = [];
  if (lines.length === 0) return chunks;

  const step = Math.max(1, chunkLines - overlapLines);
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + chunkLines);
    const slice = lines.slice(start, end).join("\n").trim();
    if (!slice) continue;
    chunks.push({
      text: slice,
      meta: { startLine: start + 1, endLine: end },
    });
    if (end >= lines.length) break;
  }
  return chunks;
}


export async function indexProject(options: RagIndexOptions = {}): Promise<RagIndexResult> {
  const cwd = options.cwd || process.cwd();
  const settings = getSettingsManager();
  const dbPath = settings.getRagDbPath(cwd);
  const ignoreRules = loadRagIgnore(cwd);

  const extractor = (options.extractor || settings.getRagExtractor(cwd)) as
    | "native"
    | "sqlite-rag";
  if (extractor === "sqlite-rag") {
    console.warn("[RAG] sqlite-rag extractor is deprecated; using native extraction.");
  }
  

  const chunkLines = options.chunkLines ?? 200;
  const overlapLines = options.overlapLines ?? 20;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 512 * 1024;
  const batchSize = options.batchSize ?? 32;

  
  const defaultExts = extractor === "sqlite-rag" ? SQLITE_RAG_DEFAULT_EXTS : DEFAULT_EXTS;
  const exts = normalizeExtensions(options.includeExtensions ?? defaultExts);

  if (options.force) {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  }

  const allFiles = await walkFiles(cwd);
  const files = allFiles.filter((f) => {
    const rel = path.relative(cwd, f);
    if (matchesIgnore(rel, ignoreRules)) return false;

    if (!hasAllowedExtension(f, exts)) return false;

    try {
      const st = fs.statSync(f);
      if (st.size > maxFileSizeBytes) return false;
    } catch {
      return false;
    }

    return true;
  });

  const embeddingClient = createEmbeddingClientFromSettings();

  // Pre‑flight embedding test
  try {
    const testVec = await embeddingClient.embed("test");
    if (!testVec.length) {
      console.warn("[RAG] Embedding API returned empty vector. Indexing may fail.");
    }
  } catch (err) {
    console.warn("[RAG] Embedding API test failed:", err instanceof Error ? err.message : String(err));
    console.warn("[RAG] Indexing will likely fail due to embedding errors.");
  }

  let dimension: number | undefined;
  if (!options.force && fs.existsSync(dbPath)) {
    try {
      const existingDb = await VectorDb.open(dbPath);
      dimension = existingDb.getDimension();
      existingDb.close();
    } catch {
      dimension = undefined;
    }
  }

  let db: VectorDb | null = null;
  if (dimension) {
    try {
      db = await VectorDb.open(dbPath, { dimension, distance: "COSINE" });
      db.beginTransaction();
    } catch {
      db = null;
    }
  }

  let filesIndexed = 0;
  let chunksIndexed = 0;

  // Buffer chunks across multiple files to reduce embedding API network roundtrips.
  const chunkBuffer: Array<{ rel: string; text: string; meta: Record<string, unknown> }> = [];

  const flushBuffer = async () => {
    if (chunkBuffer.length === 0 || !db) return;

    let vectors: number[][];
    try {
      vectors = await embeddingClient.embedBatch(chunkBuffer.map((b) => b.text));
    } catch (err) {
      logRagDebug("embedBatch failed:", err);
      vectors = [];
    }

    if (vectors.length !== chunkBuffer.length) {
      // Fallback: per-chunk embeds (best effort)
      for (const item of chunkBuffer) {
        try {
          const vec = await embeddingClient.embed(item.text);
          if (vec && vec.length === dimension) {
            db.insertChunk({
              path: item.rel,
              text: item.text,
              meta: JSON.stringify(item.meta),
              vector: vec,
            });
            chunksIndexed++;
          }
        } catch {
          // ignore
        }
      }
    } else {
      for (let i = 0; i < chunkBuffer.length; i++) {
        const vec = vectors[i];
        if (!vec || vec.length !== dimension) continue;
        db.insertChunk({
          path: chunkBuffer[i].rel,
          text: chunkBuffer[i].text,
          meta: JSON.stringify(chunkBuffer[i].meta),
          vector: vec,
        });
        chunksIndexed++;
      }
    }
    chunkBuffer.length = 0;
  };

  try {
    for (const file of files) {
      const rel = path.relative(cwd, file).replaceAll("\\", "/");

      let content = "";
try {
  content = (await extractText(file, maxFileSizeBytes)) || "";
} catch {
  continue;
}

      if (!content) continue;

      const chunks = chunkByLines(content, chunkLines, overlapLines);
      if (!chunks.length) continue;

      if (!dimension) {
        try {
          const v = await embeddingClient.embed(chunks[0].text);
          if (!v.length) continue;
          dimension = v.length;
        } catch {
          continue;
        }
      }

      if (!db) {
        if (!dimension) continue;
        db = await VectorDb.open(dbPath, { dimension, distance: "COSINE" });
        db.beginTransaction();
      }

      // Replace index for this file.
      db.deleteChunksByPath(rel);

      for (const chunk of chunks) {
        chunkBuffer.push({ rel, text: chunk.text, meta: chunk.meta });
        if (chunkBuffer.length >= batchSize) {
          await flushBuffer();
        }
      }

      filesIndexed++;
    }

    await flushBuffer();
    if (db) db.commitTransaction();
  } catch (err) {
    if (db) {
      try {
        db.rollbackTransaction();
        } catch (err) {
          logRagDebug("embed per-chunk failed:", err);
          // ignore
        }
    }
    throw err;
  }

  if (db && options.quantize) {
    try {
      db.quantize(!!options.quantizePreload);
    } catch {
      // ignore quantize failures (e.g. empty DB)
    }
  }

  if (db) db.close();
  return { dbPath, filesIndexed, chunksIndexed };
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/rag/indexer.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/rag/indexer.ts.backup_20260227T212403_901113"
//   "created_at": "2026-02-27T13:24:03.913231+00:00"
//   "backup_hash": "181ef1187a8411eb7a5860be067bed03"
//   "new_hash": "df0880357cfe50a013fb4deb6bfec155"
//   "goal_id": "delete_nativeexts_variable"
//   "semantics": "Delete unused nativeExts variable."
//   "update_attrs": {"relative_path": "src/rag/indexer.ts", "update_type": "text", "mode": "delete", "encoding": "utf-8", "find_pattern": null, "find_text": "const nativeExts = normalizeExtensions(DEFAULT_EXTS);", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/rag/indexer.ts\""
// }
