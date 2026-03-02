import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";

// Minimal SQLite3 module loader (similar to vector-db.ts)
type Sqlite3Module = any;

async function loadSqlite3Module(): Promise<Sqlite3Module> {
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
}

/**
 * Convert large GloVe-like text file to SQLite database efficiently.
 * Uses streaming to handle multi-GB files.
 * 
 * Table schema:
 *   CREATE TABLE glove (
 *     word TEXT PRIMARY KEY,
 *     dimension INTEGER NOT NULL,
 *     vector BLOB NOT NULL,  -- Float32Array of length dimension
 *     norm REAL NOT NULL
 *   );
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: bun run scripts/convert-glove-to-sqlite-stream.ts <input.txt> <output.db>");
    console.error("Example: bun run scripts/convert-glove-to-sqlite-stream.ts data/glove/wiki_giga_2024_50_MFT20_vectors_seed_123_alpha_0.75_eta_0.075_combined.txt data/glove/glove_50d.db");
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);

  console.log(`Converting ${inputPath} to ${outputPath}...`);

  // Check input file
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Create output directory if needed
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Load SQLite module
  console.log("Loading SQLite module...");
  const sqlite3 = await loadSqlite3Module();
  
  // Create in-memory database
  const db = new sqlite3.oo1.DB(":memory:", "c");
  
  // Create table
  db.exec(`
    CREATE TABLE glove (
      word TEXT PRIMARY KEY,
      dimension INTEGER NOT NULL,
      vector BLOB NOT NULL,
      norm REAL NOT NULL
    );
  `);
  
  // Create index on word for faster lookup
  db.exec("CREATE INDEX idx_glove_word ON glove(word);");
  
  // Prepare statement
  const stmt = db.prepare(`
    INSERT INTO glove (word, dimension, vector, norm)
    VALUES (?, ?, ?, ?)
  `);
  
  // Start transaction for performance
  db.exec("BEGIN TRANSACTION");
  
  let dimension = 0;
  let count = 0;
  let batchCount = 0;
  const batchSize = 10000;
  
  console.log("Processing file...");
  
  // Create read stream
  const stream = fs.createReadStream(inputPath, {
    encoding: "utf-8",
    highWaterMark: 64 * 1024, // 64KB chunks
  });
  
  let buffer = "";
  
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: string | Buffer) => {
      buffer += chunk.toString("utf-8");
      
      // Process complete lines
      const lines = buffer.split("\n");
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        const parts = trimmed.split(" ");
        if (parts.length < 2) continue;
        
        const word = parts[0];
        const vector = parts.slice(1).map(Number);
        
        if (dimension === 0) {
          dimension = vector.length;
          console.log(`Detected dimension: ${dimension}`);
        } else if (vector.length !== dimension) {
          console.warn(`Skipping malformed line for word "${word}": expected ${dimension} dimensions, got ${vector.length}`);
          continue;
        }
        
        // Compute norm
        const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
        
        // Normalize vector to unit length
        const normalized = norm > 0 ? vector.map(v => v / norm) : vector;
        
        // Convert to Float32Array then to Uint8Array for SQLite BLOB
        const float32Vector = new Float32Array(normalized);
        const vectorBlob = new Uint8Array(float32Vector.buffer);
        
        // Insert into database
        stmt.bind([word, dimension, vectorBlob, norm]);
        stmt.step();
        stmt.reset();
        
        count++;
        batchCount++;
        
        if (batchCount >= batchSize) {
          console.log(`Processed ${count} words...`);
          batchCount = 0;
        }
      }
    });
    
    stream.on("end", () => {
      // Process remaining buffer
      if (buffer.trim()) {
        const parts = buffer.trim().split(" ");
        if (parts.length >= 2) {
          const word = parts[0];
          const vector = parts.slice(1).map(Number);
          
          if (dimension === 0) {
            dimension = vector.length;
            console.log(`Detected dimension: ${dimension}`);
          } else if (vector.length === dimension) {
            const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
            const normalized = norm > 0 ? vector.map(v => v / norm) : vector;
            const float32Vector = new Float32Array(normalized);
            const vectorBlob = new Uint8Array(float32Vector.buffer);
            
            stmt.bind([word, dimension, vectorBlob, norm]);
            stmt.step();
            stmt.reset();
            count++;
          }
        }
      }
      resolve();
    });
    
    stream.on("error", reject);
  });
  
  // Commit transaction
  console.log("Committing transaction...");
  db.exec("COMMIT");
  stmt.finalize();
  
  // Export database to file
  console.log("Exporting database to file...");
  const bytes: Uint8Array = sqlite3.capi.sqlite3_js_db_export(db.pointer);
  fs.writeFileSync(outputPath, bytes);
  
  // Close database
  db.close();
  
  console.log(`\nConversion complete!`);
  console.log(`Total words: ${count}`);
  console.log(`Dimension: ${dimension}`);
  console.log(`Output file: ${outputPath} (${bytes.length} bytes)`);
  
  // Verify the database
  console.log(`\nVerifying database...`);
  const verifyDb = new sqlite3.oo1.DB(outputPath, "r");
  const verifyStmt = verifyDb.prepare("SELECT COUNT(*) as count, AVG(norm) as avg_norm FROM glove");
  verifyStmt.step();
  const result = verifyStmt.get();
  console.log(`Database contains ${result[0]} entries, average norm: ${result[1].toFixed(4)}`);
  verifyStmt.finalize();
  verifyDb.close();
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});