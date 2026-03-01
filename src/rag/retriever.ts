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
  searchChatFirst?: boolean;
  chatPrefix?: string;
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
    const searchChatFirst = options.searchChatFirst ?? true;
    const chatPrefix = options.chatPrefix ?? "chat://";

    // Helper to retrieve candidates with optional prefix
    const retrieveCandidates = async (prefix?: string, limit: number = k): Promise<RagChunkRow[]> => {
      if (prefix) {
        return db.queryTopKWithPrefix(queryVector, limit, prefix);
      } else {
        return db.queryTopN(queryVector, limit);
      }
    };

    let candidates: RagChunkRow[] = [];
    if (chatPrefix && searchChatFirst) {
      candidates = await retrieveCandidates(chatPrefix, useKMedoids ? (options.candidateCount ?? settings.getRagCandidateCount(cwd)) : k);
    }

    // If we still need more candidates (e.g., not enough chat results, or k-medoids wants more)
    if (useKMedoids) {
      const nRaw = options.candidateCount ?? settings.getRagCandidateCount(cwd);
      const n = Math.max(k, Math.floor(nRaw));
      // Ensure we have enough candidates from both sources
      const fileCandidates = await retrieveCandidates(undefined, n - candidates.length);
      candidates = [...candidates, ...fileCandidates];
    } else {
      // No k-medoids: just fill remaining slots with file results if chat results insufficient
      if (candidates.length < k) {
        const fileCandidates = await retrieveCandidates(undefined, k - candidates.length);
        candidates = [...candidates, ...fileCandidates];
      }
    }

    // Deduplicate by id (optional)
    const seen = new Set<number>();
    const uniqueCandidates = candidates.filter(c => {
      const id = Number(c.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    if (!useKMedoids || uniqueCandidates.length <= k) {
      // Return top k by distance (already sorted by distance from query)
      return uniqueCandidates.slice(0, k);
    }

    // Apply k-medoids clustering
    const ids = uniqueCandidates.map((c) => Number(c.id)).filter((x) => Number.isFinite(x) && x > 0);
    const idToVec = db.getChunkVectorsByIds(ids);
    const vectors: Float32Array[] = [];
    const rows: RagChunkRow[] = [];
    for (const c of uniqueCandidates) {
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
    const type = r.path.startsWith("chat://") ? "CHAT" : "FILE";
    const header = `---\nPATH: ${r.path}\nTYPE: ${type}\nMETA: ${r.meta ?? ""}\nDISTANCE: ${
      typeof r.distance === "number" ? r.distance.toFixed(4) : ""
    }\n---\n`;
    const body = `${r.text}\n\n`;
    if ((out + header + body).length > maxChars) break;
    out += header + body;
  }
  return out.trim();
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/rag/retriever.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/rag/retriever.ts.backup_20260301T144412_698624"
//   "created_at": "2026-03-01T06:44:12.708988+00:00"
//   "backup_hash": "1a35ec4eef1cfa712d2dd69a20c464a3"
//   "new_hash": "f27c3e8d5e1affae16592b8bfafa41bc"
//   "goal_id": "text_anchor_replace"
//   "semantics": "Replace retrieveTopK with hybrid chat/file retrieval"
//   "update_attrs": {"relative_path": "src/rag/retriever.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "export async function retrieveTopK(\n  queryText: string,\n  options: RagRetrieveOptions = {}\n): Promise<RagChunkRow[]> {\n  const cwd = options.cwd || process.cwd();\n  const settings = getSettingsManager();\n  const dbPath = settings.getRagDbPath(cwd);\n\n  if (!fs.existsSync(dbPath)) return [];\n\n  const embeddingClient = createEmbeddingClientFromSettings();\n  const queryVector = await embeddingClient.embed(queryText);\n  if (!queryVector.length) return [];\n\n  const db = await VectorDb.open(dbPath);\n  try {\n    const k = options.topK ?? settings.getRagTopK(cwd);\n    const useKMedoids = options.useKMedoids ?? settings.getRagUseKMedoids(cwd);\n\n    if (!useKMedoids) {\n      return db.queryTopK(queryVector, k);\n    }\n\n    const nRaw = options.candidateCount ?? settings.getRagCandidateCount(cwd);\n    const n = Math.max(k, Math.floor(nRaw));\n\n    const candidates = db.queryTopN(queryVector, n);\n    if (candidates.length <= k) return candidates;\n\n    const ids = candidates.map((c) => Number(c.id)).filter((x) => Number.isFinite(x) && x > 0);\n    const idToVec = db.getChunkVectorsByIds(ids);\n    const vectors: Float32Array[] = [];\n    const rows: RagChunkRow[] = [];\n    for (const c of candidates) {\n      const id = Number(c.id);\n      const vec = idToVec.get(id);\n      if (!vec) continue;\n      vectors.push(vec);\n      rows.push(c);\n    }\n    if (vectors.length <= k) return rows;\n\n    const metric = db.getDistanceMetric();\n    const dist: KMedoidsDistance = metric === \"L2\" || metric === \"SQUARED_L2\" ? \"l2\" : \"cosine\";\n\n    const medoidIdx = selectKMedoids(vectors, k, dist);\n    const selected = medoidIdx.map((i) => rows[i]).filter(Boolean);\n    // Stable prompt order: prefer closer-to-query first when distance is available.\n    selected.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));\n    return selected.slice(0, k);\n  } finally {\n    db.close();\n  }\n}", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/rag/retriever.ts\""
// }
