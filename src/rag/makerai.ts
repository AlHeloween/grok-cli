import * as fs from "fs";
import * as path from "path";
import { VectorDb } from "./vector-db.js";

export interface MakerAiVectorItem {
  data: number[];
  text?: string;
  json?: unknown;
  orden?: number;
}

export interface MakerAiVectorFile {
  name?: string;
  description?: string;
  model?: string;
  dim: number;
  data: MakerAiVectorItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const v of value) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

export function parseMakerAiVectorFile(jsonText: string): MakerAiVectorFile {
  const parsed: unknown = JSON.parse(jsonText);
  if (!isRecord(parsed)) throw new Error("MakerAI vector file must be an object.");

  const dim = Number(parsed.dim);
  if (!Number.isFinite(dim) || dim <= 0) {
    throw new Error('MakerAI vector file missing valid "dim".');
  }

  const dataRaw = parsed.data;
  if (!Array.isArray(dataRaw)) {
    throw new Error('MakerAI vector file missing valid "data" array.');
  }

  const items: MakerAiVectorItem[] = dataRaw.map((it, idx) => {
    if (!isRecord(it)) throw new Error(`MakerAI data[${idx}] must be an object.`);
    const vec = asNumberArray(it.data);
    if (!vec) throw new Error(`MakerAI data[${idx}].data must be a number array.`);
    if (vec.length !== dim) {
      throw new Error(
        `MakerAI data[${idx}].data length ${vec.length} does not match dim ${dim}.`
      );
    }
    return {
      data: vec,
      text: typeof it.text === "string" ? it.text : undefined,
      json: it.json,
      orden:
        it.orden == null
          ? undefined
          : Number.isFinite(Number(it.orden))
            ? Number(it.orden)
            : undefined,
    };
  });

  return {
    name: typeof parsed.name === "string" ? parsed.name : undefined,
    description:
      typeof parsed.description === "string" ? parsed.description : undefined,
    model: typeof parsed.model === "string" ? parsed.model : undefined,
    dim,
    data: items,
  };
}

function inferPathFromJson(json: unknown, fallback: string): string {
  if (!isRecord(json)) return fallback;
  const v =
    (typeof json.path === "string" && json.path) ||
    (typeof json.uri === "string" && json.uri) ||
    (typeof json.file === "string" && json.file) ||
    "";
  return v || fallback;
}

function normalizeMeta(json: unknown, extra: Record<string, unknown>): string {
  const base = isRecord(json) ? { ...json } : {};
  const merged = { ...base, ...extra };
  try {
    return JSON.stringify(merged);
  } catch {
    return JSON.stringify(extra);
  }
}

export interface ExportMakerAiOptions {
  name?: string;
  description?: string;
  model?: string;
  outFile: string;
  dbPath: string;
}

export async function exportVectorDbToMakerAiJson(
  options: ExportMakerAiOptions
): Promise<{ outFile: string; chunks: number; dim: number }> {
  const db = await VectorDb.open(options.dbPath);
  try {
    const dim = db.getDimension();
    if (!dim) throw new Error("RAG DB missing dimension metadata.");

    const items: MakerAiVectorItem[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const rows = db.listChunkRows(pageSize, offset);
      if (rows.length === 0) break;
      const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
      const vectors = db.getChunkVectorsByIds(ids);
      for (const row of rows) {
        const id = Number(row.id);
        const vec = vectors.get(id);
        if (!vec) continue;
        items.push({
          data: Array.from(vec),
          text: row.text,
          json: {
            id,
            path: row.path,
            meta: row.meta,
          },
          orden: id,
        });
      }
    }

    const out: MakerAiVectorFile = {
      name: options.name || path.basename(process.cwd()),
      description: options.description,
      model: options.model || "",
      dim,
      data: items,
    };

    const outPath = path.resolve(options.outFile);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
    return { outFile: outPath, chunks: items.length, dim };
  } finally {
    db.close();
  }
}

export interface ImportMakerAiOptions {
  inFile: string;
  dbPath: string;
  replace?: boolean;
}

export async function importMakerAiJsonToVectorDb(
  options: ImportMakerAiOptions
): Promise<{ dbPath: string; inserted: number; dim: number }> {
  const inPath = path.resolve(options.inFile);
  const raw = fs.readFileSync(inPath, "utf-8");
  const parsed = parseMakerAiVectorFile(raw);

  const exists = fs.existsSync(options.dbPath);
  const db = await VectorDb.open(options.dbPath, exists ? {} : { dimension: parsed.dim });
  try {
    const dim = db.getDimension() ?? parsed.dim;
    if (dim !== parsed.dim) {
      throw new Error(
        `Dimension mismatch: DB=${dim} MakerAI file=${parsed.dim}.`
      );
    }

    if (options.replace) {
      db.clearAllChunks();
    }

    let inserted = 0;
    const basePath = `makerai:${parsed.name || path.basename(inPath)}`;

    for (let i = 0; i < parsed.data.length; i++) {
      const item = parsed.data[i];
      const text = item.text ?? "";
      const p = inferPathFromJson(item.json, basePath);
      const meta = normalizeMeta(item.json, { makerai_orden: item.orden ?? i });
      db.insertChunk({ path: p, text, meta, vector: item.data });
      inserted++;
    }

    return { dbPath: options.dbPath, inserted, dim };
  } finally {
    db.close();
  }
}

