import type { ChatEntry } from "./grok-agent.js";
import type { GrokMessage, UserContent, GrokToolCall } from "../grok/client.js";
import type { ToolResult } from "../types/index.js";
import { ChatHistoryPersistence } from "./chat-history-persistence.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { indexChatHistory } from "../rag/chat-indexer.js";

export class ChatHistoryManager {
  private chatHistory: ChatEntry[] = [];
  private messages: GrokMessage[] = [];
  private maxMessages: number;
  private maxChatEntries: number;
  private persistence: ChatHistoryPersistence | null = null;
  private sessionId: string | null = null;
  private cwd: string = process.cwd();

  constructor(maxMessages = 50, maxChatEntries = 100) {
    this.maxMessages = maxMessages;
    this.maxChatEntries = maxChatEntries;
  }

  // Getters
  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  getMessages(): GrokMessage[] {
    return [...this.messages];
  }
  updateSystemMessage(content: string): void {
    if (this.messages[0]?.role === "system") {
      this.messages[0].content = content;
    }
  }

  // Add entries
  addChatEntry(entry: ChatEntry): void {
    this.chatHistory.push(entry);
    this.trimIfNeeded();
  }

  addMessage(message: GrokMessage): void {
    this.messages.push(message);
    this.trimIfNeeded();
  }

  // Trim both arrays to respect limits
  trimIfNeeded(): void {
    if (this.messages.length > this.maxMessages) {
      const system = this.messages[0];
      const rest = this.messages.slice(-(this.maxMessages - 1));
      this.messages = system ? [system, ...rest] : rest;
    }
    if (this.chatHistory.length > this.maxChatEntries) {
      this.chatHistory = this.chatHistory.slice(-this.maxChatEntries);
    }
  }

  // Convenience methods for common entry types
  addUserEntry(content: UserContent): ChatEntry {
    const entry: ChatEntry = {
      type: "user",
      content,
      timestamp: new Date(),
    };
    this.addChatEntry(entry);
    this.addMessage({
      role: "user",
      content,
    });
    return entry;
  }

  addAssistantEntry(content: string, toolCalls?: GrokToolCall[]): ChatEntry {
    const entry: ChatEntry = {
      type: "assistant",
      content,
      timestamp: new Date(),
      toolCalls,
    };
    this.addChatEntry(entry);
    this.addMessage({
      role: "assistant",
      content,
      tool_calls: toolCalls,
    });
    return entry;
  }

  addToolCallEntry(toolCall: GrokToolCall): ChatEntry {
    const entry: ChatEntry = {
      type: "tool_call",
      content: "Executing...",
      timestamp: new Date(),
      toolCall,
    };
    this.addChatEntry(entry);
    // No corresponding message entry
    return entry;
  }

  addToolResultEntry(toolCallId: string, result: ToolResult): ChatEntry {
    const entry: ChatEntry = {
      type: "tool_result",
      content: result.success
        ? result.output || "Success"
        : result.error || "Error occurred",
      timestamp: new Date(),
      toolResult: result,
    };
    this.addChatEntry(entry);
    this.addMessage({
      role: "tool",
      content: result.success
        ? result.output || "Success"
        : result.error || "Error",
      tool_call_id: toolCallId,
    });
    return entry;
  }

  addErrorEntry(content: string): ChatEntry {
    const entry: ChatEntry = {
      type: "assistant",
      content,
      timestamp: new Date(),
    };
    this.addChatEntry(entry);
    // No corresponding message entry (error not sent to API)
    return entry;
  }


  findChatEntryIndex(predicate: (entry: ChatEntry) => boolean): number {
    return this.chatHistory.findIndex(predicate);
  }

  updateChatEntry(index: number, entry: ChatEntry): void {
    this.chatHistory[index] = entry;
  }

  // Clear all history
  clear(): void {
    this.chatHistory = [];
    this.messages = [];
  }

  // Persistence methods
  async enablePersistence(cwd?: string, sessionId?: string): Promise<void> {
    this.cwd = cwd || process.cwd();
    this.persistence = new ChatHistoryPersistence();
    if (sessionId) {
      await this.loadSession(sessionId);
    } else {
      this.sessionId = this.persistence.generateSessionId();
    }
  }

  async save(): Promise<void> {
    if (!this.persistence || !this.sessionId) {
      throw new Error("Persistence not enabled. Call enablePersistence first.");
    }
    await this.persistence.saveSessionWithMessages(
      this.chatHistory,
      this.messages,
      this.sessionId,
      this.cwd
    );

    // Optional auto‑indexing of chat history into RAG
    const settings = getSettingsManager();
    if (settings.isRagEnabled(this.cwd) && settings.getRagAutoIndexChat(this.cwd)) {
      try {
        const { chunksIndexed } = await indexChatHistory(this.chatHistory, {
          cwd: this.cwd,
          sessionId: this.sessionId,
          replace: true,
        });
        console.debug(`Auto‑indexed ${chunksIndexed} chat entries into RAG`);
      } catch (error) {
        // Do not fail the save operation if indexing fails
        console.warn("Failed to auto‑index chat history into RAG:", error);
      }
    }
  }

  async loadSession(sessionId: string): Promise<void> {
    if (!this.persistence) {
      this.persistence = new ChatHistoryPersistence();
    }
    const { entries, messages } = await this.persistence.loadSessionFull(sessionId, this.cwd);
    this.chatHistory = entries;
    this.messages = messages || [];
    // Trim to limits
    this.trimIfNeeded();
  }

  getState(): { chatHistory: ChatEntry[]; messages: GrokMessage[] } {
    return {
      chatHistory: [...this.chatHistory],
      messages: [...this.messages],
    };
  }

  setState(state: { chatHistory: ChatEntry[]; messages: GrokMessage[] }): void {
    this.chatHistory = state.chatHistory;
    this.messages = state.messages;
    this.trimIfNeeded();
  }
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/agent/chat-history-manager.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/agent/chat-history-manager.ts.backup_20260301T125632_353452"
//   "created_at": "2026-03-01T04:56:32.363479+00:00"
//   "backup_hash": "398d0e5dba6e9d4f9bf0223246197d00"
//   "new_hash": "1ec1ec7dded486d31bc5777117029cfd"
//   "goal_id": "chat_history_manager_with_persistence"
//   "semantics": "Add persistence integration to ChatHistoryManager"
//   "update_attrs": {"relative_path": "src/agent/chat-history-manager.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/agent/chat-history-manager.ts\""
// }
