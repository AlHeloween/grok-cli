import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ChatHistoryPersistence } from "./chat-history-persistence.js";
import type { ChatEntry } from "./grok-agent.js";

describe("ChatHistoryPersistence", () => {
  let tempDir: string;
  let persistence: ChatHistoryPersistence;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "grok-chat-history-"));
    persistence = new ChatHistoryPersistence();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("generates unique session IDs", () => {
    const id1 = persistence.generateSessionId();
    const id2 = persistence.generateSessionId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^session_[a-z0-9]+_[a-f0-9]{8}$/);
  });

  it("saves and loads a session", async () => {
    const entries: ChatEntry[] = [
      {
        type: "user",
        content: "Hello",
        timestamp: new Date("2026-03-03T12:00:00Z"),
      },
      {
        type: "assistant",
        content: "Hi there!",
        timestamp: new Date("2026-03-03T12:01:00Z"),
      },
    ];
    const sessionId = "test_session";
    const savedPath = await persistence.saveSession(entries, sessionId, tempDir);
    expect(savedPath).toContain(sessionId);
    expect(savedPath).toContain(tempDir);

    const loaded = await persistence.loadSession(sessionId, tempDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].type).toBe("user");
    expect(loaded[0].content).toBe("Hello");
    expect(loaded[0].timestamp).toBeInstanceOf(Date);
    expect(loaded[0].timestamp.toISOString()).toBe("2026-03-03T12:00:00.000Z");
    expect(loaded[1].type).toBe("assistant");
    expect(loaded[1].content).toBe("Hi there!");
  });

  it("lists sessions", async () => {
    const entries: ChatEntry[] = [{ type: "user", content: "test", timestamp: new Date() }];
    const sessionId1 = "session1";
    const sessionId2 = "session2";
    await persistence.saveSession(entries, sessionId1, tempDir);
    await new Promise(resolve => setTimeout(resolve, 10)); // ensure timestamps differ
    await persistence.saveSession(entries, sessionId2, tempDir);

    const sessions = await persistence.listSessions(tempDir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe(sessionId2); // newest first
    expect(sessions[1].id).toBe(sessionId1);
    expect(sessions[0].count).toBe(1);
    expect(sessions[0].timestamp).toBeInstanceOf(Date);
  });

  it("deletes a session", async () => {
    const entries: ChatEntry[] = [{ type: "user", content: "test", timestamp: new Date() }];
    const sessionId = "to_delete";
    await persistence.saveSession(entries, sessionId, tempDir);
    let sessions = await persistence.listSessions(tempDir);
    expect(sessions).toHaveLength(1);

    await persistence.deleteSession(sessionId, tempDir);
    sessions = await persistence.listSessions(tempDir);
    expect(sessions).toHaveLength(0);
  });

  it("throws when loading non-existent session", async () => {
    await expect(persistence.loadSession("missing", tempDir)).rejects.toThrow();
  });
});

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/agent/chat-history-persistence.test.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-03T18:47:38.842998+00:00"
//   "new_hash": "d22c93d04e62fbbd63399d6114654f2c"
//   "goal_id": "text_create_new_file"
//   "semantics": "Create unit tests for ChatHistoryPersistence class"
//   "update_attrs": {"relative_path": "src/agent/chat-history-persistence.test.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/agent/chat-history-persistence.test.ts\""
// }
