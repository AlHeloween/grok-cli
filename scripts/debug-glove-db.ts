import { loadSqlite3Module } from "../src/rag/vector-db.js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const dbPath = path.resolve(process.cwd(), "data/glove/glove_50d.db");
  console.log(`Database file: ${dbPath}`);
  console.log(`Exists: ${fs.existsSync(dbPath)}`);
  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    console.log(`Size: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  }
  
  // Try to open with sqlite-wasm
  const sqlite3 = await loadSqlite3Module();
  console.log("SQLite module loaded");
  
  // Read file
  const buf = fs.readFileSync(dbPath);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  console.log(`Read ${bytes.length} bytes`);
  
  // Create in-memory DB
  const db = new sqlite3.oo1.DB(":memory:", "c");
  console.log("In-memory DB created");
  
  // Deserialize
  const pData = sqlite3.wasm.allocFromTypedArray(bytes);
  const len = BigInt(bytes.byteLength);
  const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
  
  const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, "main", pData, len, len, flags);
  console.log(`Deserialize result: ${rc}`);
  if (rc !== sqlite3.capi.SQLITE_OK) {
    const rcStr = typeof sqlite3.capi.sqlite3_js_rc_str === "function"
      ? sqlite3.capi.sqlite3_js_rc_str(rc)
      : String(rc);
    console.error(`Failed to deserialize: ${rcStr}`);
    return;
  }
  
  // List tables
  const tablesStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
  console.log("Tables:");
  while (tablesStmt.step()) {
    const row = tablesStmt.get();
    console.log(`  ${row[0]}`);
  }
  tablesStmt.finalize();
  
  // Check glove table columns
  const columnsStmt = db.prepare("PRAGMA table_info(glove)");
  console.log("Columns in glove table:");
  while (columnsStmt.step()) {
    const row = columnsStmt.get();
    console.log(`  ${row[1]} (${row[2]})`);
  }
  columnsStmt.finalize();
  
  // Count rows
  const countStmt = db.prepare("SELECT COUNT(*) FROM glove");
  if (countStmt.step()) {
    console.log(`Total rows: ${countStmt.get()[0]}`);
  }
  countStmt.finalize();
  
  // Sample first row
  const sampleStmt = db.prepare("SELECT * FROM glove LIMIT 1");
  if (sampleStmt.step()) {
    const row = sampleStmt.get();
    console.log("First row columns:");
    for (let i = 0; i < row.length; i++) {
      const val = row[i];
      console.log(`  [${i}] ${typeof val}: ${val instanceof Uint8Array ? `Uint8Array(${val.length})` : val}`);
    }
  }
  sampleStmt.finalize();
  
  db.close();
  console.log("Debug complete");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});