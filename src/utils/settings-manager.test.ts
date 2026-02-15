import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSettingsManager } from "./settings-manager.js";

describe("SettingsManager project settings", () => {
  it("scopes project settings to current working directory (cd-safe)", () => {
    const originalCwd = process.cwd();
    const dirA = mkdtempSync(join(tmpdir(), "grok-cli-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "grok-cli-b-"));

    try {
      const manager = getSettingsManager();

      process.chdir(dirA);
      manager.setCurrentModel("grok-3-fast");
      expect(manager.getProjectSetting("model")).toBe("grok-3-fast");

      process.chdir(dirB);
      manager.setCurrentModel("grok-4-latest");
      expect(manager.getProjectSetting("model")).toBe("grok-4-latest");

      process.chdir(dirA);
      expect(manager.getProjectSetting("model")).toBe("grok-3-fast");

      process.chdir(dirB);
      expect(manager.getProjectSetting("model")).toBe("grok-4-latest");
    } finally {
      try {
        process.chdir(originalCwd);
      } catch {}
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});

