import { describe, it, expect } from "vitest";
import { getClipboardImage, getClipboardImageSync } from "./clipboard-image.js";

describe("getClipboardImageSync", () => {
  it("returns null or valid result without throwing (CI has no display)", () => {
    const result = getClipboardImageSync();
    if (result === null) {
      expect(result).toBeNull();
    } else {
      expect(result).toHaveProperty("mimeType", "image/png");
      expect(result).toHaveProperty("base64");
      expect(typeof result.base64).toBe("string");
      expect(result.base64.length).toBeGreaterThan(0);
    }
  });
});

describe("getClipboardImage", () => {
  it("resolves null or valid result without throwing (async, CI-safe)", async () => {
    const result = await getClipboardImage();
    if (result === null) {
      expect(result).toBeNull();
    } else {
      expect(result).toHaveProperty("mimeType");
      expect(result).toHaveProperty("base64");
      expect(typeof result.mimeType).toBe("string");
      expect(typeof result.base64).toBe("string");
      expect(result.base64.length).toBeGreaterThan(0);
    }
  });
});
