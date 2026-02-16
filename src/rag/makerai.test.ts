import { describe, expect, test } from "vitest";
import { parseMakerAiVectorFile } from "./makerai.js";

describe("parseMakerAiVectorFile", () => {
  test("parses valid MakerAI vector JSON", () => {
    const json = JSON.stringify({
      name: "demo",
      description: "desc",
      model: "",
      dim: 3,
      data: [
        { data: [0.1, 0.2, 0.3], text: "hello", json: { path: "x" }, orden: 1 },
      ],
    });

    const parsed = parseMakerAiVectorFile(json);
    expect(parsed.dim).toBe(3);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]?.data).toEqual([0.1, 0.2, 0.3]);
  });

  test("rejects mismatched dim", () => {
    const json = JSON.stringify({
      dim: 2,
      data: [{ data: [0.1, 0.2, 0.3] }],
    });
    expect(() => parseMakerAiVectorFile(json)).toThrow(/does not match dim/i);
  });
});

