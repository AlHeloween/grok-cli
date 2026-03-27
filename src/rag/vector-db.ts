import * as fs from "fs";
import * as path from "path";

export type RagDistanceMetric =
  | "L2"
  | "L1"
  | "COSINE"
  | "DOT"
  | "SQUARED_L2"
  | "HAMMING";

export interface VectorDbOpenOptions {
  /** Embedding vector dimension (required when creating a new DB). */
  dimension?: number;
  /** sqlite-vector distance metric (default: COSINE). */
  distance?: RagDistanceMetric;
}

export interface RagChunkRow {
  id?: number;
  path: string;
  text: string;
  meta?: string | null;
  distance?: number;
}

type Sqlite3Module = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Oo1Db = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let sqlite3ModulePromise: Promise<Sqlite3Module> | null = null;

export async function loadSqlite3Module(): Promise<Sqlite3Module> {
  if (!sqlite3ModulePromise) {
    sqlite3ModulePromise = (async () => {
      const mod: any = await import("@sqliteai/sqlite-wasm"); // eslint-disable-line @typescript-eslint/no-explicit-any
      const sqlite3InitModule = mod?.default;
      if (typeof sqlite3InitModule !== "function") {
        throw new Error("Failed to load @sqliteai/sqlite-wasm initializer");
      }
      const sqlite3 = await sqlite3InitModule({
        print: () => undefined,
        printErr: () => undefined,
      });
      return sqlite3;
    })();
  }
  return sqlite3ModulePromise;
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteFileSync(filePath: string, data: Uint8Array): void {
  ensureParentDir(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(
    dir,
    `.${base}.tmp.${process.pid}.${Date.now().toString(16)}`
  );
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

export class VectorDb {
  private sqlite3: Sqlite3Module;
  private db: Oo1Db;
  private dbPath: string;

  private constructor(sqlite3: Sqlite3Module, db: Oo1Db, dbPath: string) {
    this.sqlite3 = sqlite3;
    this.db = db;
    this.dbPath = dbPath;
  }

  static async open(dbPath: string, options: VectorDbOpenOptions = {}): Promise<VectorDb> {
  ensureParentDir(dbPath);
  const sqlite3 = await loadSqlite3Module();

  // sqlite-wasm does not provide NodeFS-backed persistence by default. Persist
  // across processes by deserializing from disk into an in-memory DB and
  // exporting back to disk on close (when mutated).
  const db = new sqlite3.oo1.DB(":memory:", "c");
  const wrapper = new VectorDb(sqlite3, db, dbPath);
  wrapper.loadFromDiskIfPresent();
  wrapper.initializeSchema();
  await wrapper.ensureVectorInitialized(options);
  return wrapper;
}

  private dirty: boolean = false;

close(): void {
  try {
    if (this.dirty || !fs.existsSync(this.dbPath)) {
      this.persistToDisk();
    }
  } finally {
    try {
      this.db.close();
    } catch {
      // ignore close errors
    }
  }
}

private loadFromDiskIfPresent(): void {
  if (!fs.existsSync(this.dbPath)) return;
  const buf = fs.readFileSync(this.dbPath);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  this.deserializeFromBytes(bytes);
}

private deserializeFromBytes(bytes: Uint8Array): void {
  if (!bytes || bytes.byteLength === 0) return;
  const sqlite3 = this.sqlite3;
  if (!sqlite3?.config?.bigIntEnabled) {
    throw new Error(
      "sqlite-wasm BigInt support is required for persistent RAG db."
    );
  }

  const pData = sqlite3.wasm.allocFromTypedArray(bytes);
  const len = BigInt(bytes.byteLength);
  const flags =
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
    sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;

  const rc = sqlite3.capi.sqlite3_deserialize(
    this.db.pointer,
    "main",
    pData,
    len,
    len,
    flags
  );

  if (rc !== sqlite3.capi.SQLITE_OK) {
    try {
      sqlite3.wasm.dealloc(pData);
    } catch {
      // ignore
    }
    const rcStr =
      typeof sqlite3.capi.sqlite3_js_rc_str === "function"
        ? sqlite3.capi.sqlite3_js_rc_str(rc)
        : String(rc);
    throw new Error(
      `Failed to deserialize SQLite DB (${this.dbPath}): ${rcStr}`
    );
  }
}

private persistToDisk(): void {
  const sqlite3 = this.sqlite3;
  if (!sqlite3?.config?.bigIntEnabled) {
    throw new Error(
      "sqlite-wasm BigInt support is required for persistent RAG db."
    );
  }
  const bytes: Uint8Array = sqlite3.capi.sqlite3_js_db_export(this.db.pointer);
  atomicWriteFileSync(this.dbPath, bytes);
  this.dirty = false;
}

getPath(): string {
    return this.dbPath;
  }

  getDistanceMetric(): RagDistanceMetric {
    const v = this.getMeta("distance");
    return (v as RagDistanceMetric) || "COSINE";
  }

  getDimension(): number | undefined {
    const v = this.getMeta("dimension");
    const n = v != null ? Number(v) : undefined;
    return Number.isFinite(n) && (n as number) > 0 ? (n as number) : undefined;
  }

  initializeSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS rag_meta(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks(
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        text TEXT NOT NULL,
        meta TEXT,
        vector BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_path_idx ON chunks(path);
    `);
  }

  private getMeta(key: string): string | undefined {
    return this.db.selectValue(
      "SELECT value FROM rag_meta WHERE key = ?",
      [key]
    );
  }

  private setMeta(key: string, value: string): void {
  this.db.exec({
    sql: "INSERT INTO rag_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    bind: [key, value],
  });
  this.dirty = true;
}

  private async ensureVectorInitialized(options: VectorDbOpenOptions): Promise<void> {
    const existingDim = this.getMeta("dimension");
    const existingDistance = this.getMeta("distance");

    const dimension =
      existingDim != null ? Number(existingDim) : options.dimension;
    if (!Number.isFinite(dimension) || (dimension as number) <= 0) {
      throw new Error(
        "Vector DB missing dimension. Provide dimension when creating a new index."
      );
    }

    const distance: RagDistanceMetric =
      (existingDistance as RagDistanceMetric) ||
      options.distance ||
      "COSINE";

    if (!existingDim) this.setMeta("dimension", String(dimension));
    if (!existingDistance) this.setMeta("distance", String(distance));

    // vector_init may throw if called multiple times; ignore if already initialized.
    try {
      this.db.exec({
        sql: `SELECT vector_init('chunks', 'vector', 'type=FLOAT32,dimension=${dimension},distance=${distance}');`,
      });
    } catch {
      // ignore
    }
  }

  beginTransaction(): void {
    this.db.exec("BEGIN TRANSACTION;");
  }

  commitTransaction(): void {
    this.db.exec("COMMIT;");
  }

  rollbackTransaction(): void {
    try {
      this.db.exec("ROLLBACK;");
    } catch {
      // ignore rollback failure if no transaction is active
    }
  }

  insertChunk(row: {
    path: string;
    text: string;
    meta?: string | null;
    vector: number[] | Float32Array;
  }): void {
    this.db.exec({
      sql: "INSERT INTO chunks(path, text, meta, vector) VALUES(?, ?, ?, vector_as_f32(?))",
      bind: [
        row.path,
        row.text,
        row.meta ?? null,
        vectorToUint8Array(row.vector),
      ],
    });
    this.dirty = true;
  }

  deleteChunksByPath(filePath: string): void {
  this.db.exec({
    sql: "DELETE FROM chunks WHERE path = ?",
    bind: [filePath],
  });
  this.dirty = true;
}

clearAllChunks(): void {
  this.db.exec("DELETE FROM chunks;");
  this.dirty = true;
}

  quantize(preload: boolean = false): void {
  this.db.exec({
    sql: "SELECT vector_quantize('chunks', 'vector');",
  });
  if (preload) {
    this.db.exec({
      sql: "SELECT vector_quantize_preload('chunks', 'vector');",
    });
  }
  this.dirty = true;
}

  private hasQuantizationTable(): boolean {
    try {
      const result = this.db.selectValue(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'vector_quantize_%'"
      );
      return Number(result) > 0;
    } catch {
      return false;
    }
  }

  getChunkCount(): number {
    const value = this.db.selectValue("SELECT COUNT(*) FROM chunks");
    return typeof value === "number" ? value : Number(value || 0);
  }

  listChunkRows(limit: number = 500, offset: number = 0): RagChunkRow[] {
    const lim = Number(limit);
    const off = Number(offset);
    const safeLimit = Number.isFinite(lim) && lim > 0 ? Math.floor(lim) : 500;
    const safeOffset = Number.isFinite(off) && off >= 0 ? Math.floor(off) : 0;

    const rows = this.db.selectObjects(
      "SELECT id, path, text, meta FROM chunks ORDER BY id ASC LIMIT ? OFFSET ?",
      [safeLimit, safeOffset]
    ) as Array<{ id: number; path: string; text: string; meta?: string | null }>;

    return (rows || []).map((r) => ({
      id: Number(r.id),
      path: String(r.path),
      text: String(r.text),
      meta: r.meta ?? null,
    }));
  }

  queryTopK(vector: number[] | Float32Array, k: number): RagChunkRow[] {
    const vec = vectorToUint8Array(vector);
    if (!vec.length || k <= 0) return [];

    // Try quantized scan first (if quantization has been enabled)
    try {
      const rows = this.db.selectObjects(
        `
        SELECT c.id, c.path, c.text, c.meta, v.distance
        FROM chunks AS c
        JOIN vector_quantize_scan('chunks', 'vector', vector_as_f32(?), ?) AS v
        ON c.id = v.rowid
        ORDER BY v.distance ASC
        `,
        [vec, k]
      );
      return (rows || []) as RagChunkRow[];
    } catch (error: any) {
      // If quantization table not found, fall back to vector_full_scan (exact search)
      if (
        error.message?.includes?.("Quantization table not found") ||
        error.message?.includes?.("vector_quantize() has been called")
      ) {
        // Use vector_full_scan for exact similarity search
        const rows = this.db.selectObjects(
          `
          SELECT c.id, c.path, c.text, c.meta, v.distance
          FROM chunks AS c
          JOIN vector_full_scan('chunks', 'vector', vector_as_f32(?), ?) AS v
          ON c.id = v.rowid
          ORDER BY v.distance ASC
          `,
          [vec, k]
        );
        return (rows || []) as RagChunkRow[];
      }
      // Other error, re-throw
      throw error;
    }
  }

  queryTopN(vector: number[] | Float32Array, n: number): RagChunkRow[] {
    return this.queryTopK(vector, n);
  }

  getChunkVectorsByIds(ids: number[]): Map<number, Float32Array> {
    const out = new Map<number, Float32Array>();
    const uniq = Array.from(new Set(ids.filter((x) => Number.isFinite(x) && x > 0)));
    if (uniq.length === 0) return out;

    const placeholders = uniq.map(() => "?").join(", ");
    const rows = this.db.selectObjects(
      `SELECT id, vector FROM chunks WHERE id IN (${placeholders})`,
      uniq
    ) as Array<{ id: number; vector: unknown }>;

    for (const r of rows || []) {
      const id = Number(r.id);
      const blob = r.vector;
      const vec = decodeFloat32Blob(blob);
      if (Number.isFinite(id) && vec) out.set(id, vec);
    }
    return out;
  }
  queryTopKWithPrefix(
    vector: number[] | Float32Array,
    k: number,
    pathPrefix: string
  ): RagChunkRow[] {
    const vec = vectorToUint8Array(vector);
    if (!vec.length || k <= 0) return [];

    // Try quantized scan first (if quantization has been enabled)
    try {
      const rows = this.db.selectObjects(
        `
        SELECT c.id, c.path, c.text, c.meta, v.distance
        FROM chunks AS c
        JOIN vector_quantize_scan('chunks', 'vector', vector_as_f32(?), ?) AS v
        ON c.id = v.rowid
        WHERE c.path LIKE ?
        ORDER BY v.distance ASC
        `,
        [vec, k, `${pathPrefix}%`]
      );
      return (rows || []) as RagChunkRow[];
    } catch (error: any) {
      // If quantization table not found, fall back to vector_full_scan (exact search)
      if (
        error.message?.includes?.("Quantization table not found") ||
        error.message?.includes?.("vector_quantize() has been called")
      ) {
        // Use vector_full_scan for exact similarity search
        const rows = this.db.selectObjects(
          `
          SELECT c.id, c.path, c.text, c.meta, v.distance
          FROM chunks AS c
          JOIN vector_full_scan('chunks', 'vector', vector_as_f32(?), ?) AS v
          ON c.id = v.rowid
          WHERE c.path LIKE ?
          ORDER BY v.distance ASC
          `,
          [vec, k, `${pathPrefix}%`]
        );
        return (rows || []) as RagChunkRow[];
      }
      // Other error, re-throw
      throw error;
    }
  }

  deleteChunksByPathPrefix(prefix: string): void {
    this.db.exec({
      sql: "DELETE FROM chunks WHERE path LIKE ?",
      bind: [`${prefix}%`],
    });
    this.dirty = true;
  }
}

/**
 * Convert a vector (number[] or Float32Array) to a Uint8Array blob for SQLite binding.
 * This is significantly faster than JSON.stringify for large vectors.
 */
function vectorToUint8Array(vector: number[] | Float32Array): Uint8Array {
  if (vector instanceof Float32Array) {
    return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  }
  return new Uint8Array(new Float32Array(vector).buffer);
}

function decodeFloat32Blob(blob: unknown): Float32Array | null {
  if (!blob) return null;

  // Node Buffer
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(blob)) {
    const b = blob as Buffer;
    const len = Math.floor(b.byteLength / 4);
    return new Float32Array(b.buffer, b.byteOffset, len);
  }

  // sqlite-wasm commonly returns Uint8Array for blobs
  if (blob instanceof Uint8Array) {
    const len = Math.floor(blob.byteLength / 4);
    return new Float32Array(blob.buffer, blob.byteOffset, len);
  }

  if (blob instanceof ArrayBuffer) {
    return new Float32Array(blob);
  }

  // Some bindings return {buffer: ArrayBuffer, byteOffset, byteLength}
  if (typeof blob === "object" && blob !== null) {
    const obj = blob as Record<string, unknown>;
    if (
      obj.buffer instanceof ArrayBuffer &&
      typeof obj.byteOffset === "number" &&
      typeof obj.byteLength === "number"
    ) {
      const len = Math.floor(obj.byteLength / 4);
      return new Float32Array(obj.buffer, obj.byteOffset, len);
    }
  }

  return null;
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/rag/vector-db.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/rag/vector-db.ts.backup_20260301T143147_221550"
//   "created_at": "2026-03-01T06:31:47.243392+00:00"
//   "backup_hash": "ff02fd2a65778e39c30f2867efbc73b6"
//   "new_hash": "91404d0c226abed3d3d1429ae5647fe9"
//   "goal_id": "text_insert_before_anchor"
//   "semantics": "Add chat-specific query and delete methods to VectorDb class"
//   "update_attrs": {"relative_path": "src/rag/vector-db.ts", "update_type": "text", "mode": "insert", "encoding": "utf-8", "find_pattern": null, "find_text": "}\n\nfunction decodeFloat32Blob", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/rag/vector-db.ts\""
// }
