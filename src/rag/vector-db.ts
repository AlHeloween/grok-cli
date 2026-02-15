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

type Sqlite3Module = any;
type Oo1Db = any;

let sqlite3ModulePromise: Promise<Sqlite3Module> | null = null;

async function loadSqlite3Module(): Promise<Sqlite3Module> {
  if (!sqlite3ModulePromise) {
    sqlite3ModulePromise = (async () => {
      const mod: any = await import("@sqliteai/sqlite-wasm");
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

    // Note: oo1.DB() uses sqlite-wasm virtual FS. In Node, this is expected to
    // create a file-backed DB at the given path when supported by the build.
    const db = new sqlite3.oo1.DB(dbPath, "ct");
    const wrapper = new VectorDb(sqlite3, db, dbPath);
    wrapper.initializeSchema();
    await wrapper.ensureVectorInitialized(options);
    return wrapper;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore close errors
    }
  }

  getPath(): string {
    return this.dbPath;
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

  insertChunk(row: { path: string; text: string; meta?: string | null; vector: number[] }): void {
    this.db.exec({
      sql: "INSERT INTO chunks(path, text, meta, vector) VALUES(?, ?, ?, vector_as_f32(?))",
      bind: [
        row.path,
        row.text,
        row.meta ?? null,
        JSON.stringify(row.vector),
      ],
    });
  }

  deleteChunksByPath(filePath: string): void {
    this.db.exec({
      sql: "DELETE FROM chunks WHERE path = ?",
      bind: [filePath],
    });
  }

  clearAllChunks(): void {
    this.db.exec("DELETE FROM chunks;");
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
  }

  getChunkCount(): number {
    const value = this.db.selectValue("SELECT COUNT(*) FROM chunks");
    return typeof value === "number" ? value : Number(value || 0);
  }

  queryTopK(vector: number[], k: number): RagChunkRow[] {
    if (!vector.length || k <= 0) return [];
    const rows = this.db.selectObjects(
      `
      SELECT c.id, c.path, c.text, c.meta, v.distance
      FROM chunks AS c
      JOIN vector_quantize_scan('chunks', 'vector', vector_as_f32(?), ?) AS v
      ON c.id = v.rowid
      ORDER BY v.distance ASC
      `,
      [JSON.stringify(vector), k]
    );
    return (rows || []) as RagChunkRow[];
  }
}

