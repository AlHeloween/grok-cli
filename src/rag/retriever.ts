import * as fs from "fs";
import { createEmbeddingClientFromSettings } from "./embedding-client.js";
import { VectorDb, RagChunkRow } from "./vector-db.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { selectKMedoids, type KMedoidsDistance } from "./k-medoids.js";

export interface RagRetrieveOptions {
  cwd?: string;
  topK?: number;
  useKMedoids?: boolean;
  candidateCount?: number;
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
    const useKMedoids = options.useKMedoids ?? settings.getRagUseKMedoids(cwd);

    if (!useKMedoids) {
      return db.queryTopK(queryVector, k);
    }

    const nRaw = options.candidateCount ?? settings.getRagCandidateCount(cwd);
    const n = Math.max(k, Math.floor(nRaw));

    const candidates = db.queryTopN(queryVector, n);
    if (candidates.length <= k) return candidates;

    const ids = candidates.map((c) => Number(c.id)).filter((x) => Number.isFinite(x) && x > 0);
    const idToVec = db.getChunkVectorsByIds(ids);
    const vectors: Float32Array[] = [];
    const rows: RagChunkRow[] = [];
    for (const c of candidates) {
      const id = Number(c.id);
      const vec = idToVec.get(id);
      if (!vec) continue;
      vectors.push(vec);
      rows.push(c);
    }
    if (vectors.length <= k) return rows;

    const metric = db.getDistanceMetric();
    const dist: KMedoidsDistance = metric === "L2" || metric === "SQUARED_L2" ? "l2" : "cosine";

    const medoidIdx = selectKMedoids(vectors, k, dist);
    const selected = medoidIdx.map((i) => rows[i]).filter(Boolean);
    // Stable prompt order: prefer closer-to-query first when distance is available.
    selected.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return selected.slice(0, k);
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

