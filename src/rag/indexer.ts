import * as fs from "fs";
import * as path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { createEmbeddingClientFromSettings } from "./embedding-client.js";
import { VectorDb } from "./vector-db.js";
import { getSettingsManager } from "../utils/settings-manager.js";

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
    } catch {
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

type PythonInvocation = { cmd: string; argsPrefix: string[] };

let cachedPython: PythonInvocation | null = null;

function parsePythonSetting(value: string): PythonInvocation {
  const cmd = value.trim();
  const base = path.basename(cmd).toLowerCase();
  if (base === "py" || base === "py.exe") return { cmd, argsPrefix: ["-3"] };
  return { cmd, argsPrefix: [] };
}

function resolvePythonInvocation(requested?: string): PythonInvocation {
  const env = process.env.GROK_RAG_PYTHON?.trim();
  const configured = requested?.trim() || env;
  if (configured) return parsePythonSetting(configured);

  if (cachedPython) return cachedPython;

  const candidates: PythonInvocation[] = [
    { cmd: "python", argsPrefix: [] },
    { cmd: "python3", argsPrefix: [] },
    { cmd: "py", argsPrefix: ["-3"] },
  ];

  for (const c of candidates) {
    try {
      const r = spawnSync(c.cmd, [...c.argsPrefix, "--version"], {
        windowsHide: true,
        timeout: 2000,
        encoding: "utf8",
      });
      if (r.status === 0) {
        cachedPython = c;
        return c;
      }
    } catch {
      // ignore
    }
  }

  cachedPython = candidates[0];
  return cachedPython;
}

function getExtractScriptPath(): string {
  const env = process.env.GROK_RAG_EXTRACT_SCRIPT?.trim();
  if (env) return env;

  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../scripts/sqlite_rag_extract.py");
}

async function extractTextWithSqliteRag(
  filePath: string,
  maxBytes: number,
  pythonSetting?: string
): Promise<string | null> {
  const scriptPath = getExtractScriptPath();
  const py = resolvePythonInvocation(pythonSetting);

  const args = [
    ...py.argsPrefix,
    scriptPath,
    "--path",
    filePath,
    "--max-bytes",
    String(maxBytes),
  ];

  return await new Promise((resolve) => {
    const child = spawn(py.cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let killed = false;
    const maxOut = Math.max(1024 * 1024, maxBytes + 1024);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      if (killed) return;
      stdout += chunk;
      if (stdout.length > maxOut) {
        killed = true;
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    });

    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      const out = stdout.trim();
      if (killed) return resolve(out || null);
      if (code === 0) return resolve(out || null);
      return resolve(null);
    });
  });
}

export async function indexProject(options: RagIndexOptions = {}): Promise<RagIndexResult> {
  const cwd = options.cwd || process.cwd();
  const settings = getSettingsManager();
  const dbPath = settings.getRagDbPath(cwd);
  const ignoreRules = loadRagIgnore(cwd);

  const extractor = (options.extractor || settings.getRagExtractor(cwd)) as
    | "native"
    | "sqlite-rag";
  const python = options.python || settings.getRagPython(cwd);

  const chunkLines = options.chunkLines ?? 200;
  const overlapLines = options.overlapLines ?? 20;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 512 * 1024;
  const batchSize = options.batchSize ?? 32;

  const nativeExts = normalizeExtensions(DEFAULT_EXTS);
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
    } catch {
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
        const ext = path.extname(file).toLowerCase();
        const preferNative = extractor !== "sqlite-rag" || nativeExts.includes(ext);

        if (preferNative) {
          content = fs.readFileSync(file, "utf-8");
        } else {
          content = (await extractTextWithSqliteRag(file, maxFileSizeBytes, python)) || "";
        }
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
      } catch {
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
//   "backup_path": "D:\\zPython\\grok-cli\\src/rag/indexer.ts.backup_20260216T225608_906672"
//   "created_at": "2026-02-16T14:56:08.917831+00:00"
//   "backup_hash": "98fd6853fc9f9817a7622331cbd8a53d"
//   "new_hash": "f99617c85ab5dbefcad00ac7e2e5e5db"
//   "goal_id": "rag_indexer_restore_quantize_close"
//   "semantics": "Restore end-of-function quantize and close now that db assignment is visible to TS."
//   "update_attrs": {"relative_path": "src/rag/indexer.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "if (options.quantize) {\n    try {\n      db?.quantize(!!options.quantizePreload);\n    } catch {\n      // ignore quantize failures (e.g. empty DB)\n    }\n  }\n\n  db?.close();\n  return { dbPath, filesIndexed, chunksIndexed };\n}", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/rag/indexer.ts\""
// }
