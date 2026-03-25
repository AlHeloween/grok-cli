import { describe, it, expect, vi, beforeEach } from "vitest";
import { SqliteGloVeLoader } from "./sqlite-loader.js";
import * as fs from "fs";

// Mock loadSqlite3Module to return a mock sqlite3
vi.mock("../../rag/vector-db.js", () => ({
  loadSqlite3Module: vi.fn(async () => ({
    oo1: {
      DB: vi.fn().mockImplementation(() => ({
        selectValue: vi.fn((sql) => {
          if (sql.includes("dimension")) return 3;
          return null;
        }),
        selectArrays: vi.fn((sql, params) => {
          if (sql.includes("SELECT word, vector FROM glove WHERE word IN")) {
            const results = [];
            if (params.includes("hello")) {
              results.push(["hello", new Uint8Array(new Float32Array([1, 0, 0]).buffer)]);
            }
            if (params.includes("world")) {
              results.push(["world", new Uint8Array(new Float32Array([0, 1, 0]).buffer)]);
            }
            return results;
          }
          return [];
        }),
        pointer: 123,
        close: vi.fn(),
      })),
    },
    wasm: {
      allocFromTypedArray: vi.fn(() => 456),
      dealloc: vi.fn(),
    },
    capi: {
      SQLITE_DESERIALIZE_FREEONCLOSE: 1,
      SQLITE_DESERIALIZE_RESIZEABLE: 2,
      SQLITE_OK: 0,
      sqlite3_deserialize: vi.fn(() => 0),
    },
    config: {
      bigIntEnabled: true,
    },
  })),
}));

describe("SqliteGloVeLoader.getVectorsBatch", () => {
  const tempDbPath = "temp_test_glove.db";

  beforeEach(() => {
    if (!fs.existsSync(tempDbPath)) {
      fs.writeFileSync(tempDbPath, "dummy content");
    }
  });

  it("should fetch multiple vectors in a single batch", async () => {
    const loader = new SqliteGloVeLoader();
    await loader.open(tempDbPath);

    const words = ["hello", "world", "missing"];
    const vectors = loader.getVectorsBatch(words);

    expect(vectors.size).toBe(2);
    expect(Array.from(vectors.get("hello")!)).toEqual([1, 0, 0]);
    expect(Array.from(vectors.get("world")!)).toEqual([0, 1, 0]);
    expect(vectors.has("missing")).toBe(false);

    loader.close();
  });

  it("should use cache for subsequent calls", async () => {
    const loader = new SqliteGloVeLoader();
    await loader.open(tempDbPath);

    loader.getVectorsBatch(["hello"]);

    // @ts-expect-error - accessing private member for testing
    const db = loader.db;
    const selectArraysSpy = vi.spyOn(db, "selectArrays");

    const vectors = loader.getVectorsBatch(["hello", "world"]);
    expect(vectors.size).toBe(2);

    // Should only fetch "world" from DB
    expect(selectArraysSpy).toHaveBeenCalledWith(
      expect.stringContaining("WHERE word IN (?)"),
      ["world"]
    );

    loader.close();
  });
});
