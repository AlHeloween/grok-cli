import * as fs from "fs";
import * as path from "path";
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

function isProbablyTextFile(filePath: string, exts: string[]): boolean {
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

export async function indexProject(options: RagIndexOptions = {}): Promise<RagIndexResult> {
  const cwd = options.cwd || process.cwd();
  const settings = getSettingsManager();
  const dbPath = settings.getRagDbPath(cwd);
  const ignoreRules = loadRagIgnore(cwd);

  const chunkLines = options.chunkLines ?? 200;
  const overlapLines = options.overlapLines ?? 20;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 512 * 1024;
  const batchSize = options.batchSize ?? 32;
  const exts = (options.includeExtensions ?? DEFAULT_EXTS).map((e) =>
    e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`
  );

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
    if (!isProbablyTextFile(f, exts)) return false;
    try {
      const st = fs.statSync(f);
      if (st.size > maxFileSizeBytes) return false;
    } catch {
      return false;
    }
    return true;
  });

  const embeddingClient = createEmbeddingClientFromSettings();

  // We need a dimension to initialize sqlite-vector. Fetch one embedding first.
  let dimension: number | undefined;
  for (const file of files) {
    try {
      const text = fs.readFileSync(file, "utf-8");
      const chunks = chunkByLines(text, chunkLines, overlapLines);
      if (!chunks.length) continue;
      const v = await embeddingClient.embed(chunks[0].text);
      if (v.length > 0) {
        dimension = v.length;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!dimension) {
    return { dbPath, filesIndexed: 0, chunksIndexed: 0 };
  }

  const db = await VectorDb.open(dbPath, { dimension, distance: "COSINE" });

  let filesIndexed = 0;
  let chunksIndexed = 0;

  for (const file of files) {
    const rel = path.relative(cwd, file).replaceAll("\\", "/");
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const chunks = chunkByLines(content, chunkLines, overlapLines);
    if (!chunks.length) continue;

    // Replace index for this file.
    db.deleteChunksByPath(rel);

    // Embed in batches for throughput.
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      let vectors: number[][];
      try {
        vectors = await embeddingClient.embedBatch(batch.map((b) => b.text));
      } catch {
        vectors = [];
      }
      if (vectors.length !== batch.length) {
        // fallback: per-chunk embeds (best effort)
        vectors = [];
        for (const b of batch) {
          try {
            vectors.push(await embeddingClient.embed(b.text));
          } catch {
            vectors.push([]);
          }
        }
      }

      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec || vec.length !== dimension) continue;
        const meta = JSON.stringify(batch[j].meta);
        db.insertChunk({
          path: rel,
          text: batch[j].text,
          meta,
          vector: vec,
        });
        chunksIndexed++;
      }
    }

    filesIndexed++;
  }

  if (options.quantize) {
    try {
      db.quantize(!!options.quantizePreload);
    } catch {
      // ignore quantize failures (e.g. empty DB)
    }
  }

  db.close();
  return { dbPath, filesIndexed, chunksIndexed };
}

