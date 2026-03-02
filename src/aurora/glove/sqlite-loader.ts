import { loadSqlite3Module } from "../../rag/vector-db.js";
import * as fs from "fs";
import { dotProduct } from "../simd/dot-product.js";


type Sqlite3Module = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Oo1Db = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface GloVeVector {
  word: string;
  vector: number[];
  norm: number;
}

/**
 * GloVe loader that uses SQLite database for fast vector retrieval.
 * The database should have table:
 *   CREATE TABLE glove (
 *     word TEXT PRIMARY KEY,
 *     dimension INTEGER NOT NULL,
 *     vector BLOB NOT NULL,  -- Float32Array of length dimension
 *     norm REAL NOT NULL
 *   );
 */
export class SqliteGloVeLoader {
  private sqlite3: Sqlite3Module | null = null;
  private db: Oo1Db | null = null;
  public dimension: number = 0;
  private wordCache: Map<string, Float32Array> = new Map();
  private normCache: Map<string, number> = new Map();
  public vectors: Map<string, number[]> = new Map();
  public norms: Map<string, number> = new Map();

  /**
   * Open a SQLite database containing GloVe vectors.
   */
  async open(dbPath: string): Promise<void> {
    if (this.db) {
      throw new Error("Loader already opened");
    }

    this.sqlite3 = await loadSqlite3Module();
    
    // Read database file into memory
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database file not found: ${dbPath}`);
    }
    const buf = fs.readFileSync(dbPath);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    
    // Create in-memory database
    this.db = new this.sqlite3.oo1.DB(":memory:", "c");
    
    // Deserialize the database
    this.deserializeFromBytes(bytes);
    
    // Check table exists and get dimension
    const result = this.db.selectValue("SELECT dimension FROM glove LIMIT 1");
    if (result !== null) {
      this.dimension = result as number;
    }
    
    if (this.dimension === 0) {
      throw new Error("Invalid glove database or empty table");
    }
    
    console.log(`[SqliteGloVeLoader] Opened database: ${dbPath}, dimension: ${this.dimension}`);
  }

  private deserializeFromBytes(bytes: Uint8Array): void {
    if (!bytes || bytes.byteLength === 0) return;
    const sqlite3 = this.sqlite3!;
    if (!sqlite3?.config?.bigIntEnabled) {
      throw new Error("sqlite-wasm BigInt support is required for loading GloVe database.");
    }

    const pData = sqlite3.wasm.allocFromTypedArray(bytes);
    const len = BigInt(bytes.byteLength);
    const flags =
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
      sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;

    const rc = sqlite3.capi.sqlite3_deserialize(
      this.db!.pointer,
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
      throw new Error(`Failed to deserialize SQLite DB: ${rcStr}`);
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.sqlite3 = null;
    this.wordCache.clear();
    this.normCache.clear();
  }

  getDimension(): number {
    return this.dimension;
  }

  /**
   * Get vector for a word as Float32Array.
   * Returns null if word not found.
   */
  getVectorAsFloat32(word: string): Float32Array | null {
    const normalizedWord = word.toLowerCase();
    
    // Check cache first
    if (this.wordCache.has(normalizedWord)) {
      return this.wordCache.get(normalizedWord)!;
    }
    
    if (!this.db) {
      throw new Error("Database not opened");
    }
    
    const rows = this.db.selectArrays("SELECT vector FROM glove WHERE word = ?", [normalizedWord]);
    if (rows.length > 0) {
      const blob = rows[0][0] as Uint8Array;
      const float32Array = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
      this.wordCache.set(normalizedWord, float32Array);
      return float32Array;
    }
    
    return null;
  }

  /**
   * Get vector for a word as number array (compatibility with GloVeLoader interface).
   * Returns undefined if word not found.
   */
  getVector(word: string): number[] | undefined {
    return this.getVectorAsArray(word) ?? undefined;
  }

  /**
   * Get vector as number array.
   */
  getVectorAsArray(word: string): number[] | null {
    const vec = this.getVectorAsFloat32(word);
    return vec ? Array.from(vec) : null;
  }

  /**
   * Get norm for a word.
   */
  getNorm(word: string): number {
    const normalizedWord = word.toLowerCase();
    
    if (this.normCache.has(normalizedWord)) {
      return this.normCache.get(normalizedWord)!;
    }
    
    if (!this.db) {
      throw new Error("Database not opened");
    }
    
    const result = this.db.selectValue("SELECT norm FROM glove WHERE word = ?", [normalizedWord]);
    let norm = 0;
    if (result !== null) {
      norm = result as number;
      this.normCache.set(normalizedWord, norm);
    }
    
    return norm;
  }

  hasWord(word: string): boolean {
    return this.getVectorAsFloat32(word) !== null;
  }

  /**
   * Cosine similarity between two words.
   * Both vectors are already normalized in database.
   */
  similarity(word1: string, word2: string): number {
    const v1 = this.getVectorAsFloat32(word1);
    const v2 = this.getVectorAsFloat32(word2);
    if (!v1 || !v2) return 0;
    
    const dot = dotProduct(v1, v2);
    return dot;
  }

  /**
   * Find top K words most similar to a target vector.
   */
  findSimilarWords(targetVector: number[] | Float32Array, topK: number = 10): Array<{word: string, score: number}> {
    if (!this.db) {
      throw new Error("Database not opened");
    }
    
    // Convert to Float32Array if needed
    const floatVector = targetVector instanceof Float32Array ? targetVector : new Float32Array(targetVector);
    
    const rows = this.db.selectArrays("SELECT word, vector FROM glove");
    const results: Array<{word: string, score: number}> = [];
    
    for (const row of rows) {
      const word = row[0] as string;
      const blob = row[1] as Uint8Array;
      const vector = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
      
      const dot = dotProduct(floatVector, vector);
      results.push({ word, score: dot });
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Find top K words most similar to a target word.
   */
  findSimilarToWord(targetWord: string, topK: number = 10): Array<{word: string, score: number}> {
    const targetVector = this.getVectorAsFloat32(targetWord);
    if (!targetVector) return [];
    return this.findSimilarWords(targetVector, topK);
  }

  /**
   * Get all words in vocabulary (cached scan).
   */
  getVocabulary(): string[] {
    if (!this.db) {
      throw new Error("Database not opened");
    }
    
    const rows = this.db.selectArrays("SELECT word FROM glove");
    return rows.map((row: unknown[]) => row[0] as string);
  }

  /**
   * Batch similarity computation for multiple words.
   * Returns Map<word, similarity>
   */
  batchSimilarity(targetWord: string, words: string[]): Map<string, number> {
    const targetVector = this.getVectorAsFloat32(targetWord);
    if (!targetVector) return new Map();
    
    const result = new Map<string, number>();
    
    for (const word of words) {
      const vec = this.getVectorAsFloat32(word);
      if (vec) {
        const dot = dotProduct(targetVector, vec);
        result.set(word, dot);
      }
    }
    
    return result;
  }

  /**
   * Load GloVe vectors from a text file (not supported for SQLite loader).
   */
  async loadFromFile(_filePath: string): Promise<void> {
    throw new Error("SQLite loader does not support loading from text file");
  }

  /**
   * Load GloVe vectors from a URL (not supported for SQLite loader).
   */
  async loadFromUrl(_url: string, _cacheDir?: string): Promise<void> {
    throw new Error("SQLite loader does not support loading from URL");
  }
}

/**
 * Create a SQLite GloVe loader and open the database.
 */
export async function createSqliteGloVeLoader(dbPath: string): Promise<SqliteGloVeLoader> {
  const loader = new SqliteGloVeLoader();
  await loader.open(dbPath);
  return loader;
}
