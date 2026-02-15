import * as fs from "fs";
import { createEmbeddingClientFromSettings } from "./embedding-client.js";
import { VectorDb, RagChunkRow } from "./vector-db.js";
import { getSettingsManager } from "../utils/settings-manager.js";

export interface RagRetrieveOptions {
  cwd?: string;
  topK?: number;
}

export async function retrieveTopK(
  queryText: string,
  options: RagRetrieveOptions = {}
): Promise<RagChunkRow[]> {
  const cwd = options.cwd || process.cwd();
  const settings = getSettingsManager();
  const dbPath = settings.getRagDbPath(cwd);

  if (!fs.existsSync(dbPath)) return [];

  const embeddingClient = createEmbeddingClientFromSettings();
  const queryVector = await embeddingClient.embed(queryText);
  if (!queryVector.length) return [];

  const db = await VectorDb.open(dbPath);
  try {
    const k = options.topK ?? settings.getRagTopK(cwd);
    return db.queryTopK(queryVector, k);
  } finally {
    db.close();
  }
}

export function formatRagChunksForPrompt(
  rows: RagChunkRow[],
  maxChars: number = 12_000
): string {
  let out = "";
  for (const r of rows) {
    const header = `---\nPATH: ${r.path}\nMETA: ${r.meta ?? ""}\nDISTANCE: ${
      typeof r.distance === "number" ? r.distance.toFixed(4) : ""
    }\n---\n`;
    const body = `${r.text}\n\n`;
    if ((out + header + body).length > maxChars) break;
    out += header + body;
  }
  return out.trim();
}

