import type { ChatEntry } from "./grok-agent.js";
import type { GrokMessage, UserContent, GrokToolCall } from "../grok/client.js";
import type { ToolResult } from "../types/index.js";

export class ChatHistoryManager {
  private chatHistory: ChatEntry[] = [];
  private messages: GrokMessage[] = [];
  private maxMessages: number;
  private maxChatEntries: number;

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

  getChatEntry(index: number): ChatEntry {
    return this.chatHistory[index];
  }

  // Clear all history
  clear(): void {
    this.chatHistory = [];
    this.messages = [];
  }
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/agent/chat-history-manager.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/agent/chat-history-manager.ts.backup_20260301T025519_286500"
//   "created_at": "2026-02-28T18:55:19.297315+00:00"
//   "backup_hash": "764cee0cdfa925b5d4ebdce10537bb7b"
//   "new_hash": "2dd2a95521338f5a0f69435d52fcd695"
//   "goal_id": "text_overwrite_full_file"
//   "semantics": "Add findChatEntryIndex and updateChatEntry methods to ChatHistoryManager"
//   "update_attrs": {"relative_path": "src/agent/chat-history-manager.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/agent/chat-history-manager.ts\""
// }
