import * as fs from "fs";
import * as path from "path";
import { loadSqlite3Module } from "../src/rag/vector-db.js";

interface GloVeEntry {
  word: string;
  vector: Float32Array;
  norm: number;
}

/**
 * Convert GloVe text file to SQLite database.
 * 
 * The SQLite database will have table:
 *   CREATE TABLE glove (
 *     word TEXT PRIMARY KEY,
 *     dimension INTEGER,
 *     vector BLOB,  -- Float32Array of length dimension
 *     norm REAL
 *   );
 * 
 * Usage: bun run scripts/convert-glove-to-sqlite.ts <input.txt> <output.db>
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: bun run scripts/convert-glove-to-sqlite.ts <input.txt> <output.db>");
    console.error("Example: bun run scripts/convert-glove-to-sqlite.ts data/glove/glove.6B.50d.txt data/glove/glove.db");
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
  
  // Read input file line by line
  const content = fs.readFileSync(inputPath, "utf-8");
  const lines = content.split("\n").filter(line => line.trim());
  
  let dimension = 0;
  let count = 0;
  const batchSize = 10000;
  
  // Prepare statement
  const stmt = db.prepare(`
    INSERT INTO glove (word, dimension, vector, norm)
    VALUES (?, ?, ?, ?)
  `);
  
  // Start transaction for performance
  db.exec("BEGIN TRANSACTION");
  
  for (const line of lines) {
    const parts = line.split(" ");
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
    
    // Convert to Float32Array
    const float32Vector = new Float32Array(normalized);
    
    // Insert into database
    stmt.bind([word, dimension, float32Vector, norm]);
    stmt.step();
    stmt.reset();
    
    count++;
    
    if (count % batchSize === 0) {
      console.log(`Processed ${count} words...`);
    }
  }
  
  // Commit transaction
  db.exec("COMMIT");
  stmt.finalize();
  
  // Export database to file
  const bytes: Uint8Array = sqlite3.capi.sqlite3_js_db_export(db.pointer);
  fs.writeFileSync(outputPath, bytes);
  
  // Close database
  db.close();
  
  console.log(`Conversion complete!`);
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