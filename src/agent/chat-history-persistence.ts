import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import type { ChatEntry } from "./grok-agent.js";
import type { GrokMessage } from "../grok/client.js";

export class ChatHistoryPersistence {
  private readonly historyDirName = "chat-history";

  /**
   * Get the chat history directory path for the given working directory.
   * Creates the directory if it doesn't exist.
   */
  private async ensureHistoryDir(cwd: string): Promise<string> {
    const dir = path.join(cwd, ".grok", this.historyDirName);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Generate a session ID based on timestamp and random bytes.
   */
  generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString("hex");
    return `session_${timestamp}_${random}`;
  }

  /**
   * Save chat entries as a session file.
   * @returns The full path to the saved file.
   */
  async saveSession(entries: ChatEntry[], sessionId: string, cwd: string = process.cwd()): Promise<string> {
    const dir = await this.ensureHistoryDir(cwd);
    const filePath = path.join(dir, `${sessionId}.json`);
    const data = JSON.stringify(
      {
        metadata: {
          sessionId,
          savedAt: new Date().toISOString(),
          entryCount: entries.length,
          version: "1.0",
        },
        entries,
      },
      null,
      2
    );
    await this.atomicWriteFile(filePath, data);
    return filePath;
  }

  /**
   * Save chat entries and optional messages as a session file.
   * @returns The full path to the saved file.
   */
  async saveSessionWithMessages(
    entries: ChatEntry[],
    messages: GrokMessage[],
    sessionId: string,
    cwd: string = process.cwd()
  ): Promise<string> {
    const dir = await this.ensureHistoryDir(cwd);
    const filePath = path.join(dir, `${sessionId}.json`);
    const data = JSON.stringify(
      {
        metadata: {
          sessionId,
          savedAt: new Date().toISOString(),
          entryCount: entries.length,
          messageCount: messages.length,
          version: "1.0",
        },
        entries,
        messages,
      },
      null,
      2
    );
    await this.atomicWriteFile(filePath, data);
    return filePath;
  }

  /**
   * Load session file and return both entries and messages.
   */
  async loadSessionFull(
    sessionId: string,
    cwd: string = process.cwd()
  ): Promise<{ entries: ChatEntry[]; messages?: GrokMessage[] }> {
    const dir = path.join(cwd, ".grok", this.historyDirName);
    const filePath = path.join(dir, `${sessionId}.json`);
    const content = await fsp.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    // Validate structure
    if (!Array.isArray(parsed.entries)) {
      throw new Error(`Invalid session file: missing entries array`);
    }
    // Convert timestamp strings back to Date objects
    const entries = parsed.entries.map((entry: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => ({
      ...entry,
      timestamp: new Date(entry.timestamp),
    }));
    return {
      entries,
      messages: parsed.messages,
    };
  }

  /**
   * Load chat entries from a session file.
   */
  async loadSession(sessionId: string, cwd: string = process.cwd()): Promise<ChatEntry[]> {
    const dir = path.join(cwd, ".grok", this.historyDirName);
    const filePath = path.join(dir, `${sessionId}.json`);
    const content = await fsp.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    // Validate structure
    if (!Array.isArray(parsed.entries)) {
      throw new Error(`Invalid session file: missing entries array`);
    }
    // Convert timestamp strings back to Date objects
    return parsed.entries.map((entry: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => ({
      ...entry,
      timestamp: new Date(entry.timestamp),
    }));
  }

  /**
   * List all session files in the chat history directory.
   */
  async listSessions(cwd: string = process.cwd()): Promise<Array<{id: string; timestamp: Date; count: number}>> {
    const dir = path.join(cwd, ".grok", this.historyDirName);
    try {
      await fsp.access(dir);
    } catch {
      // Directory doesn't exist yet → no sessions
      return [];
    }
    const files = await fsp.readdir(dir);
    const sessions = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const sessionId = path.basename(file, ".json");
      const filePath = path.join(dir, file);
      try {
        const content = await fsp.readFile(filePath, "utf-8");
        const parsed = JSON.parse(content);
        sessions.push({
          id: sessionId,
          timestamp: new Date(parsed.metadata?.savedAt || fs.statSync(filePath).mtime),
          count: parsed.metadata?.entryCount || 0,
        });
      } catch {
        // Skip corrupt files
      }
    }
    // Sort by timestamp descending (newest first)
    sessions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return sessions;
  }

  /**
   * Delete a session file.
   */
  async deleteSession(sessionId: string, cwd: string = process.cwd()): Promise<void> {
    const dir = path.join(cwd, ".grok", this.historyDirName);
    const filePath = path.join(dir, `${sessionId}.json`);
    await fsp.unlink(filePath);
  }

  /**
   * Atomically write a file by writing to a temporary file first, then renaming.
   */
  private async atomicWriteFile(filePath: string, data: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await fsp.writeFile(tempPath, data, "utf-8");
    await fsp.rename(tempPath, filePath);
  }
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/agent/chat-history-persistence.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-01T04:46:51.825767+00:00"
//   "new_hash": "63ed4423f9359321ffedb3e9514e1cf3"
//   "goal_id": "create_chat_history_persistence"
//   "semantics": "Create ChatHistoryPersistence class for atomic JSON writes to .grok/chat-history/"
//   "update_attrs": {"relative_path": "src/agent/chat-history-persistence.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/agent/chat-history-persistence.ts\""
// }
