import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, test } from "vitest";
import { VectorDb } from "./vector-db.js";
import { exportVectorDbToMakerAiJson, importMakerAiJsonToVectorDb } from "./makerai.js";

describe("MakerAI export/import roundtrip", () => {
  test("exports rag.db to MakerAI JSON and imports into a new DB", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grok-cli-makerai-"));
    const srcDbPath = path.join(tmpRoot, "src.db");
    const dstDbPath = path.join(tmpRoot, "dst.db");
    const outJsonPath = path.join(tmpRoot, "makerai-ragvector.json");

    const srcDb = await VectorDb.open(srcDbPath, { dimension: 3 });
    try {
      srcDb.insertChunk({
        path: "demo.txt",
        text: "hello",
        meta: JSON.stringify({ tag: "demo" }),
        vector: [0.1, 0.2, 0.3],
      });
    } finally {
      srcDb.close();
    }

    const exportRes = await exportVectorDbToMakerAiJson({
      dbPath: srcDbPath,
      outFile: outJsonPath,
      name: "demo",
      description: "desc",
      model: "",
    });
    expect(exportRes.chunks).toBe(1);
    expect(exportRes.dim).toBe(3);
    expect(fs.existsSync(outJsonPath)).toBe(true);

    const importRes = await importMakerAiJsonToVectorDb({
      inFile: outJsonPath,
      dbPath: dstDbPath,
      replace: true,
    });
    expect(importRes.inserted).toBe(1);
    expect(importRes.dim).toBe(3);

    const dstDb = await VectorDb.open(dstDbPath);
    try {
      expect(dstDb.getChunkCount()).toBe(1);
      const rows = dstDb.listChunkRows(10, 0);
      expect(rows[0]?.path).toBe("demo.txt");
      expect(rows[0]?.text).toBe("hello");
    } finally {
      dstDb.close();
    }
  });
});

