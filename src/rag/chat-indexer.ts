import { createEmbeddingClientFromSettings } from "./embedding-client.js";
import { VectorDb } from "./vector-db.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { computeSemanticVectorsForSession } from "./semantic-vector.js";
import type { ChatEntry } from "../agent/grok-agent.js";

export interface ChatIndexOptions {
  cwd?: string;
  sessionId: string;
  /** If true, delete previous chat entries for this session before indexing */
  replace?: boolean;
}

/**
 * Index chat history entries into the RAG vector DB.
 * Each entry is stored with path `chat://session/<sessionId>/<entryIdx>`
 * and metadata containing ADID fields.
 */
export async function indexChatHistory(
  entries: ChatEntry[],
  options: ChatIndexOptions
): Promise<{ chunksIndexed: number }> {
  const cwd = options.cwd || process.cwd();
  const settings = getSettingsManager();
  const dbPath = settings.getRagDbPath(cwd);
  const embeddingClient = createEmbeddingClientFromSettings();

  // Embed all entries first, collect vectors in batch to reduce network roundtrips
  const texts: string[] = entries.map((entry) =>
    typeof entry.content === "string"
      ? `[${entry.type}] ${entry.content}`
      : `[${entry.type}] ${JSON.stringify(entry.content)}`
  );

  const vectors = texts.length > 0 ? await embeddingClient.embedBatch(texts) : [];

  // Find first non‑empty vector to determine embedding dimension
  const validIdx = vectors.findIndex(v => v.length > 0);
  if (validIdx === -1) {
    throw new Error("Failed to get embedding dimension – all entries produced empty vectors");
  }
  const dimension = vectors[validIdx].length;

  // Collect valid entries for semantic vector computation
  const validIndices: number[] = [];
  const validVectors: number[][] = [];
  const validTexts: string[] = [];
  for (let i = 0; i < vectors.length; i++) {
    if (vectors[i].length > 0) {
      validIndices.push(i);
      validVectors.push(vectors[i]);
      validTexts.push(texts[i]);
    }
  }

  // Compute semantic vectors for valid entries
  let semanticVectors: Array<Array<{keyword: string; weight: number}>> = [];
  let semanticDominants: string[] = [];
  if (validVectors.length > 0) {
    const result = computeSemanticVectorsForSession(validVectors, validTexts);
    semanticVectors = result.semanticVectors;
    semanticDominants = result.semanticDominants;
  }

  const db = await VectorDb.open(dbPath, { dimension, distance: "COSINE" });
  try {
    db.beginTransaction();

    const prefix = `chat://session/${options.sessionId}/`;
    if (options.replace !== false) {
      db.deleteChunksByPathPrefix(prefix);
    }

    let chunksIndexed = 0;
    for (let i = 0; i < entries.length; i++) {
      const vector = vectors[i];
      if (!vector.length) continue;

      const entry = entries[i];
      // Find position in validIndices to retrieve computed semantic vector
      const validPos = validIndices.indexOf(i);
      const semanticVector = validPos >= 0 ? semanticVectors[validPos] : entry.semanticVector;
      const semanticDominant = validPos >= 0 ? semanticDominants[validPos] : entry.semanticDominant;

      const meta = {
        timestamp: entry.timestamp.toISOString(),
        type: entry.type,
        svHash: entry.svHash,
        msgHash: entry.msgHash,
        prevSVHashes: entry.prevSVHashes,
        semanticDominant,
        semanticVector,
      };
      db.insertChunk({
        path: `${prefix}${i}`,
        text: texts[i],
        meta: JSON.stringify(meta),
        vector,
      });
      chunksIndexed++;
    }

    db.commitTransaction();
    return { chunksIndexed };
  } catch (error) {
    db.rollbackTransaction();
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Delete all chat entries for a given session.
 */
export async function deleteChatSession(
  sessionId: string,
  cwd?: string
): Promise<void> {
  const settings = getSettingsManager();
  const dbPath = settings.getRagDbPath(cwd || process.cwd());
  const db = await VectorDb.open(dbPath);
  try {
    db.deleteChunksByPathPrefix(`chat://session/${sessionId}/`);
  } finally {
    db.close();
  }
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/rag/chat-indexer.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-01T06:37:49.524235+00:00"
//   "new_hash": "c68254e308ca20d92d45b7434fe6e26d"
//   "goal_id": "text_create_new_file"
//   "semantics": "Create chat indexer for indexing chat history into RAG vector DB"
//   "update_attrs": {"relative_path": "src/rag/chat-indexer.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/rag/chat-indexer.ts\""
// }
