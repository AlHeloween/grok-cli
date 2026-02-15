import {
  AgentToolResponse,
  GrokClient,
  GrokMessage,
  GrokToolCall,
  UserContent,
  UserContentPart,
} from "../grok/client.js";
import {
  getAllGrokTools,
  initializeMCPServers,
} from "../grok/tools.js";
import { loadMCPConfig } from "../mcp/config.js";
import {
  TextEditorTool,
  MorphEditorTool,
  BashTool,
  TodoTool,
  ConfirmationTool,
  SearchTool,
} from "../tools/index.js";
import { ToolResult } from "../types/index.js";
import { EventEmitter } from "events";
import { createTokenCounter, TokenCounter } from "../utils/token-counter.js";
import { loadCustomInstructions } from "../utils/custom-instructions.js";
import { getSettingsManager } from "../utils/settings-manager.js";
import { getSystemPrompt } from "./system-prompt.js";
import { executeTool as executeToolCall, type ToolExecutorContext } from "./tool-executor.js";
import { formatRagChunksForPrompt, retrieveTopK } from "../rag/retriever.js";

export interface ChatEntry {
  type: "user" | "assistant" | "tool_result" | "tool_call";
  content: string | UserContentPart[];
  timestamp: Date;
  toolCalls?: GrokToolCall[];
  toolCall?: GrokToolCall;
  toolResult?: { success: boolean; output?: string; error?: string };
  isStreaming?: boolean;
}

export interface StreamingChunk {
  type: "content" | "tool_calls" | "tool_result" | "done" | "token_count";
  content?: string;
  toolCalls?: GrokToolCall[];
  toolCall?: GrokToolCall;
  toolResult?: ToolResult;
  tokenCount?: number;
}

export class GrokAgent extends EventEmitter {
  private grokClient: GrokClient;
  private textEditor: TextEditorTool;
  private morphEditor: MorphEditorTool | null;
  private bash: BashTool;
  private todoTool: TodoTool;
  private confirmationTool: ConfirmationTool;
  private search: SearchTool;
  private chatHistory: ChatEntry[] = [];
  private messages: GrokMessage[] = [];
  private baseSystemPrompt: string;
  private tokenCounter: TokenCounter;
  private abortController: AbortController | null = null;
  private mcpInitialized: boolean = false;
  private maxToolRounds: number;

  /** Max conversation messages sent to the API (system + recent). Older messages are dropped to bound context size. */
  private static readonly MAX_MESSAGES = 50;
  /** Max chat history entries kept in memory for UI. */
  private static readonly MAX_CHAT_ENTRIES = 100;

  private trimHistoryIfNeeded(): void {
    if (this.messages.length > GrokAgent.MAX_MESSAGES) {
      const system = this.messages[0];
      const rest = this.messages.slice(-(GrokAgent.MAX_MESSAGES - 1));
      this.messages = system ? [system, ...rest] : rest;
    }
    if (this.chatHistory.length > GrokAgent.MAX_CHAT_ENTRIES) {
      this.chatHistory = this.chatHistory.slice(-GrokAgent.MAX_CHAT_ENTRIES);
    }
  }

  constructor(
    apiKey: string,
    baseURL?: string,
    model?: string,
    maxToolRounds?: number,
    maxTokens?: number
  ) {
    super();
    const manager = getSettingsManager();
    const savedModel = manager.getCurrentModel();
    const modelToUse = model || savedModel || "grok-code-fast-1";
    this.maxToolRounds = maxToolRounds || 400;
    const tokensToUse = maxTokens ?? manager.getMaxTokens();
    this.grokClient = new GrokClient(apiKey, modelToUse, baseURL, tokensToUse);
    this.textEditor = new TextEditorTool();
    const morphKey = manager.getMorphApiKey();
    this.morphEditor = morphKey ? new MorphEditorTool(morphKey) : null;
    this.bash = new BashTool();
    this.todoTool = new TodoTool();
    this.confirmationTool = new ConfirmationTool();
    this.search = new SearchTool();
    this.tokenCounter = createTokenCounter(modelToUse);

    // Initialize MCP servers if configured
    this.initializeMCP();

    // Initialize with system message
    const customInstructions = loadCustomInstructions();
    this.baseSystemPrompt = getSystemPrompt({
      hasMorphEditor: !!this.morphEditor,
      customInstructions: customInstructions ?? undefined,
    });
    this.messages.push({ role: "system", content: this.baseSystemPrompt });
  }

  /**
   * Reconfigure API connection at runtime (used by /config).
   * Keeps history/messages but replaces the underlying Grok client.
   */
  public reconfigureConnection(options: {
    apiKey?: string;
    baseURL?: string;
    maxTokens?: number;
  }): void {
    const manager = getSettingsManager();
    const apiKey = options.apiKey || manager.getApiKey();
    if (!apiKey) return;
    const baseURL = options.baseURL || manager.getBaseURL();
    const maxTokens = options.maxTokens ?? manager.getMaxTokens();
    const model = this.grokClient.getCurrentModel();
    this.grokClient = new GrokClient(apiKey, model, baseURL, maxTokens);
  }

  /** Refresh Morph availability and system prompt (used by /config). */
  public refreshMorphEditor(): void {
    const manager = getSettingsManager();
    const morphKey = manager.getMorphApiKey();
    this.morphEditor = morphKey ? new MorphEditorTool(morphKey) : null;

    const customInstructions = loadCustomInstructions();
    this.baseSystemPrompt = getSystemPrompt({
      hasMorphEditor: !!this.morphEditor,
      customInstructions: customInstructions ?? undefined,
    });
    if (this.messages[0]?.role === "system") {
      this.messages[0].content = this.baseSystemPrompt;
    }
  }

  private async maybeInjectRagContext(userMessageText: string): Promise<void> {
    // Always reset system prompt each turn to avoid accumulating context.
    if (this.messages[0]?.role === "system") {
      this.messages[0].content = this.baseSystemPrompt;
    }

    const settings = getSettingsManager();
    if (!settings.isRagEnabled()) return;

    try {
      const rows = await retrieveTopK(userMessageText, {
        cwd: process.cwd(),
        topK: settings.getRagTopK(),
        useKMedoids: settings.getRagUseKMedoids(),
        candidateCount: settings.getRagCandidateCount(),
      });
      if (!rows.length) return;

      const formatted = formatRagChunksForPrompt(rows);
      if (!formatted) return;

      if (this.messages[0]?.role === "system") {
        this.messages[0].content =
          this.baseSystemPrompt +
          "\n\nRELEVANT PROJECT CONTEXT (use when answering; prefer citing file paths):\n" +
          formatted;
      }
    } catch {
      // Best-effort only: if RAG fails, proceed without it.
      if (this.messages[0]?.role === "system") {
        this.messages[0].content = this.baseSystemPrompt;
      }
    }
  }

  private getToolExecutorContext(): ToolExecutorContext {
    return {
      textEditor: this.textEditor,
      morphEditor: this.morphEditor,
      bash: this.bash,
      todoTool: this.todoTool,
      search: this.search,
    };
  }

  private async initializeMCP(): Promise<void> {
    // Initialize MCP in the background without blocking
    Promise.resolve().then(async () => {
      try {
        const config = loadMCPConfig();
        if (config.servers.length > 0) {
          await initializeMCPServers();
        }
      } catch (error) {
        console.warn("MCP initialization failed:", error);
      } finally {
        this.mcpInitialized = true;
      }
    });
  }

  private isGrokModel(): boolean {
    const currentModel = this.grokClient.getCurrentModel();
    return currentModel.toLowerCase().includes("grok");
  }

  // Heuristic: enable web search only when likely needed
  private shouldUseSearchFor(message: string): boolean {
    const q = message.toLowerCase();
    const keywords = [
      "today",
      "latest",
      "news",
      "trending",
      "breaking",
      "current",
      "now",
      "recent",
      "x.com",
      "twitter",
      "tweet",
      "what happened",
      "as of",
      "update on",
      "release notes",
      "changelog",
      "price",
    ];
    if (keywords.some((k) => q.includes(k))) return true;
    // crude date pattern (e.g., 2024/2025) may imply recency
    if (/(20\d{2})/.test(q)) return true;
    return false;
  }

  private shouldUseAgentToolsForMessage(message: string): boolean {
    return this.isGrokModel() && this.shouldUseSearchFor(message);
  }

  private getUserContentText(content: UserContent): string {
    if (typeof content === "string") {
      return content;
    }

    return content
      .map((part) =>
        part.type === "input_text"
          ? part.text
          : `[image:${part.image_url.slice(0, 128)}]`
      )
      .join(" ");
  }

  private isGrok41FastModel(): boolean {
    const currentModel = this.grokClient.getCurrentModel().toLowerCase();
    return currentModel.includes("grok-4-1-fast");
  }

  private getAgentToolCalls(response: AgentToolResponse): GrokToolCall[] {
    const output = Array.isArray(response.output) ? response.output : [];
    return output
      .filter((item: any) => item?.type === "function_call" && item?.name)
      .map((item: any) => ({
        id: item.call_id || item.id || `call_${Date.now()}`,
        type: "function",
        function: {
          name: item.name,
          arguments: item.arguments || "{}",
        },
      }));
  }

  private getAgentAssistantText(response: AgentToolResponse): string {
    if (typeof response.output_text === "string" && response.output_text.trim()) {
      return response.output_text;
    }
    const output = Array.isArray(response.output) ? response.output : [];
    const messageTexts: string[] = [];
    for (const item of output as any[]) {
      if (item?.type !== "message" || !Array.isArray(item.content)) {
        continue;
      }
      for (const part of item.content) {
        if (
          part &&
          (part.type === "output_text" || part.type === "text") &&
          typeof part.text === "string"
        ) {
          messageTexts.push(part.text);
        }
      }
    }
    return messageTexts.join("\n").trim();
  }

  async processUserMessage(message: UserContent): Promise<ChatEntry[]> {
    const messageText = this.getUserContentText(message);
    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });
    this.trimHistoryIfNeeded();

    const newEntries: ChatEntry[] = [userEntry];
    const maxToolRounds = this.maxToolRounds; // Prevent infinite loops
    let toolRounds = 0;

    try {
      const tools = await getAllGrokTools();
      // Web search is only available via Agent Tools (Responses API + web_search tool).
      const includeWebSearch = this.shouldUseSearchFor(messageText);
      const useAgentTools =
        this.isGrok41FastModel() || this.shouldUseAgentToolsForMessage(messageText);
      let currentResponse = useAgentTools
        ? await this.grokClient.chatWithAgentTools(
            this.messages,
            tools,
            undefined,
            includeWebSearch
          )
        : await this.grokClient.chat(this.messages, tools, undefined);

      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        this.trimHistoryIfNeeded();
        const assistantMessage = useAgentTools
          ? {
              content: this.getAgentAssistantText(currentResponse as AgentToolResponse),
              tool_calls: this.getAgentToolCalls(currentResponse as AgentToolResponse),
            }
          : (currentResponse as any).choices?.[0]?.message;

        if (!assistantMessage) {
          throw new Error("No response from Grok");
        }

        // Handle tool calls
        if (
          assistantMessage.tool_calls &&
          assistantMessage.tool_calls.length > 0
        ) {
          toolRounds++;

          // Add assistant message with tool calls
          const assistantEntry: ChatEntry = {
            type: "assistant",
            content: assistantMessage.content || "Using tools to help you...",
            timestamp: new Date(),
            toolCalls: assistantMessage.tool_calls,
          };
          this.chatHistory.push(assistantEntry);
          newEntries.push(assistantEntry);

          // Add assistant message to conversation
          this.messages.push({
            role: "assistant",
            content: assistantMessage.content || "",
            tool_calls: assistantMessage.tool_calls,
          } as any);

          // Create initial tool call entries to show tools are being executed
          assistantMessage.tool_calls.forEach((toolCall: GrokToolCall) => {
            const toolCallEntry: ChatEntry = {
              type: "tool_call",
              content: "Executing...",
              timestamp: new Date(),
              toolCall: toolCall,
            };
            this.chatHistory.push(toolCallEntry);
            newEntries.push(toolCallEntry);
          });

          // Execute tool calls and update the entries
          const toolResultsForAgentTools: Array<{ callId: string; output: string }> =
            [];
          for (const toolCall of assistantMessage.tool_calls) {
            const result = await this.executeTool(toolCall);

            // Update the existing tool_call entry with the result
            const entryIndex = this.chatHistory.findIndex(
              (entry) =>
                entry.type === "tool_call" && entry.toolCall?.id === toolCall.id
            );

            if (entryIndex !== -1) {
              const updatedEntry: ChatEntry = {
                ...this.chatHistory[entryIndex],
                type: "tool_result",
                content: result.success
                  ? result.output || "Success"
                  : result.error || "Error occurred",
                toolResult: result,
              };
              this.chatHistory[entryIndex] = updatedEntry;

              // Also update in newEntries for return value
              const newEntryIndex = newEntries.findIndex(
                (entry) =>
                  entry.type === "tool_call" &&
                  entry.toolCall?.id === toolCall.id
              );
              if (newEntryIndex !== -1) {
                newEntries[newEntryIndex] = updatedEntry;
              }
            }

            // Add tool result to messages with proper format (needed for AI context)
            this.messages.push({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });

            if (useAgentTools) {
              toolResultsForAgentTools.push({
                callId: toolCall.id,
                output: result.success
                  ? result.output || "Success"
                  : result.error || "Error",
              });
            }
          }

          // Get next response - this might contain more tool calls
          if (useAgentTools) {
            const responseId = (currentResponse as AgentToolResponse).id;
            currentResponse = await this.grokClient.continueAgentToolsChat(
              responseId,
              toolResultsForAgentTools,
              tools,
              undefined,
              includeWebSearch
            );
          } else {
            currentResponse = await this.grokClient.chat(
              this.messages,
              tools,
              undefined
            );
          }
        } else {
          // No more tool calls, add final response
          const finalEntry: ChatEntry = {
            type: "assistant",
            content:
              assistantMessage.content ||
              "I understand, but I don't have a specific response.",
            timestamp: new Date(),
          };
          this.chatHistory.push(finalEntry);
          this.messages.push({
            role: "assistant",
            content: assistantMessage.content || "",
          });
          newEntries.push(finalEntry);
          break; // Exit the loop
        }
      }

      if (toolRounds >= maxToolRounds) {
        const warningEntry: ChatEntry = {
          type: "assistant",
          content:
            "Maximum tool execution rounds reached. Stopping to prevent infinite loops.",
          timestamp: new Date(),
        };
        this.chatHistory.push(warningEntry);
        newEntries.push(warningEntry);
      }

      return newEntries;
    } catch (error: any) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date(),
      };
      this.chatHistory.push(errorEntry);
      return [userEntry, errorEntry];
    }
  }

  private messageReducer(previous: any, item: any): any {
    const reduce = (acc: any, delta: any) => {
      acc = { ...acc };
      for (const [key, value] of Object.entries(delta)) {
        if (acc[key] === undefined || acc[key] === null) {
          acc[key] = value;
          // Clean up index properties from tool calls
          if (Array.isArray(acc[key])) {
            for (const arr of acc[key]) {
              delete arr.index;
            }
          }
        } else if (typeof acc[key] === "string" && typeof value === "string") {
          (acc[key] as string) += value;
        } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
          const accArray = acc[key] as any[];
          for (let i = 0; i < value.length; i++) {
            if (!accArray[i]) accArray[i] = {};
            accArray[i] = reduce(accArray[i], value[i]);
          }
        } else if (typeof acc[key] === "object" && typeof value === "object") {
          acc[key] = reduce(acc[key], value);
        }
      }
      return acc;
    };

    return reduce(previous, item.choices[0]?.delta || {});
  }

  private async *processUserMessageStreamWithAgentTools(
    inputTokens: number,
    includeWebSearch: boolean
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    const maxToolRounds = this.maxToolRounds;
    let toolRounds = 0;
    let totalOutputTokens = 0;

    const tools = await getAllGrokTools();
    let currentResponse = await this.grokClient.chatWithAgentTools(
      this.messages,
      tools,
      undefined,
      includeWebSearch,
      this.abortController?.signal
    );

    while (toolRounds < maxToolRounds) {
      this.trimHistoryIfNeeded();
      if (this.abortController?.signal.aborted) {
        yield {
          type: "content",
          content: "\n\n[Operation cancelled by user]",
        };
        yield { type: "done" };
        return;
      }

      const assistantContent = this.getAgentAssistantText(currentResponse);
      const toolCalls = this.getAgentToolCalls(currentResponse);

      // Keep local history aligned with regular chat.completions flow.
      this.messages.push({
        role: "assistant",
        content: assistantContent || "",
        tool_calls: toolCalls.length > 0 ? (toolCalls as any) : undefined,
      } as any);

      this.chatHistory.push({
        type: "assistant",
        content: assistantContent || "Using tools to help you...",
        timestamp: new Date(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      if (assistantContent) {
        totalOutputTokens += this.tokenCounter.countTokens(assistantContent);
        yield { type: "content", content: assistantContent };
        yield {
          type: "token_count",
          tokenCount: inputTokens + totalOutputTokens,
        };
      }

      if (toolCalls.length === 0) {
        break;
      }

      toolRounds++;
      yield { type: "tool_calls", toolCalls };

      const toolResultsForAgentTools: Array<{ callId: string; output: string }> =
        [];
      for (const toolCall of toolCalls) {
        if (this.abortController?.signal.aborted) {
          yield {
            type: "content",
            content: "\n\n[Operation cancelled by user]",
          };
          yield { type: "done" };
          return;
        }

        const result = await this.executeTool(toolCall);
        const outputText = result.success
          ? result.output || "Success"
          : result.error || "Error";

        this.messages.push({
          role: "tool",
          content: outputText,
          tool_call_id: toolCall.id,
        });

        this.chatHistory.push({
          type: "tool_result",
          content: outputText,
          timestamp: new Date(),
          toolCall,
          toolResult: result,
        });

        toolResultsForAgentTools.push({
          callId: toolCall.id,
          output: outputText,
        });

        yield {
          type: "tool_result",
          toolCall,
          toolResult: result,
        };
      }

      inputTokens = this.tokenCounter.countMessageTokens(this.messages as any);
      yield {
        type: "token_count",
        tokenCount: inputTokens + totalOutputTokens,
      };

      currentResponse = await this.grokClient.continueAgentToolsChat(
        currentResponse.id,
        toolResultsForAgentTools,
        tools,
        undefined,
        includeWebSearch,
        this.abortController?.signal
      );
    }

    if (toolRounds >= maxToolRounds) {
      yield {
        type: "content",
        content:
          "\n\nMaximum tool execution rounds reached. Stopping to prevent infinite loops.",
      };
    }

    yield { type: "done" };
  }

  async *processUserMessageStream(
    message: UserContent
  ): AsyncGenerator<StreamingChunk, void, unknown> {
    const messageText = this.getUserContentText(message);
    // Create new abort controller for this request
    this.abortController = new AbortController();
    await this.maybeInjectRagContext(messageText);

    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistory.push(userEntry);
    this.messages.push({ role: "user", content: message });
    this.trimHistoryIfNeeded();

    // Calculate input tokens
    let inputTokens = this.tokenCounter.countMessageTokens(
      this.messages as any
    );
    yield {
      type: "token_count",
      tokenCount: inputTokens,
    };

    const includeWebSearch = this.shouldUseSearchFor(messageText);
    const useAgentTools =
      this.isGrok41FastModel() || this.shouldUseAgentToolsForMessage(messageText);

    if (useAgentTools) {
      try {
        yield* this.processUserMessageStreamWithAgentTools(
          inputTokens,
          includeWebSearch
        );
      } catch (error: any) {
        if (this.abortController?.signal.aborted) {
          yield {
            type: "content",
            content: "\n\n[Operation cancelled by user]",
          };
          yield { type: "done" };
        } else {
          const errorEntry: ChatEntry = {
            type: "assistant",
            content: `Sorry, I encountered an error: ${error.message}`,
            timestamp: new Date(),
          };
          this.chatHistory.push(errorEntry);
          yield {
            type: "content",
            content:
              typeof errorEntry.content === "string"
                ? errorEntry.content
                : "Sorry, I encountered an error.",
          };
          yield { type: "done" };
        }
      } finally {
        this.abortController = null;
      }
      return;
    }

    const maxToolRounds = this.maxToolRounds; // Prevent infinite loops
    let toolRounds = 0;
    let totalOutputTokens = 0;
    let lastTokenUpdate = 0;
    const tools = await getAllGrokTools();

    try {
      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        this.trimHistoryIfNeeded();
        // Check if operation was cancelled
        if (this.abortController?.signal.aborted) {
          yield {
            type: "content",
            content: "\n\n[Operation cancelled by user]",
          };
          yield { type: "done" };
          return;
        }

        // Stream response and accumulate
        const stream = this.grokClient.chatStream(
          this.messages,
          tools,
          undefined,
          this.abortController?.signal
        );
        let accumulatedMessage: any = {};
        let accumulatedContent = "";
        let toolCallsYielded = false;

        for await (const chunk of stream) {
          // Check for cancellation in the streaming loop
          if (this.abortController?.signal.aborted) {
            yield {
              type: "content",
              content: "\n\n[Operation cancelled by user]",
            };
            yield { type: "done" };
            return;
          }

          if (!chunk.choices?.[0]) continue;

          // Accumulate the message using reducer
          accumulatedMessage = this.messageReducer(accumulatedMessage, chunk);

          // Check for tool calls - yield when we have complete tool calls with function names
          if (!toolCallsYielded && accumulatedMessage.tool_calls?.length > 0) {
            // Check if we have at least one complete tool call with a function name
            const hasCompleteTool = accumulatedMessage.tool_calls.some(
              (tc: any) => tc.function?.name
            );
            if (hasCompleteTool) {
              yield {
                type: "tool_calls",
                toolCalls: accumulatedMessage.tool_calls,
              };
              toolCallsYielded = true;
            }
          }

          // Stream content as it comes
          if (chunk.choices[0].delta?.content) {
            accumulatedContent += chunk.choices[0].delta.content;

            // Update token count in real-time including accumulated content and any tool calls
            const currentOutputTokens =
              this.tokenCounter.estimateStreamingTokens(accumulatedContent) +
              (accumulatedMessage.tool_calls
                ? this.tokenCounter.countTokens(
                    JSON.stringify(accumulatedMessage.tool_calls)
                  )
                : 0);
            totalOutputTokens = currentOutputTokens;

            yield {
              type: "content",
              content: chunk.choices[0].delta.content,
            };

            // Emit token count update
            const now = Date.now();
            if (now - lastTokenUpdate > 250) {
              lastTokenUpdate = now;
              yield {
                type: "token_count",
                tokenCount: inputTokens + totalOutputTokens,
              };
            }
        }
      }

        // Add assistant entry to history
        const assistantEntry: ChatEntry = {
          type: "assistant",
          content: accumulatedMessage.content || "Using tools to help you...",
          timestamp: new Date(),
          toolCalls: accumulatedMessage.tool_calls || undefined,
        };
        this.chatHistory.push(assistantEntry);

        // Add accumulated message to conversation
        this.messages.push({
          role: "assistant",
          content: accumulatedMessage.content || "",
          tool_calls: accumulatedMessage.tool_calls,
        } as any);

        // Handle tool calls if present
        if (accumulatedMessage.tool_calls?.length > 0) {
          toolRounds++;

          // Only yield tool_calls if we haven't already yielded them during streaming
          if (!toolCallsYielded) {
            yield {
              type: "tool_calls",
              toolCalls: accumulatedMessage.tool_calls,
            };
          }

          // Execute tools
          for (const toolCall of accumulatedMessage.tool_calls) {
            // Check for cancellation before executing each tool
            if (this.abortController?.signal.aborted) {
              yield {
                type: "content",
                content: "\n\n[Operation cancelled by user]",
              };
              yield { type: "done" };
              return;
            }

            const result = await this.executeTool(toolCall);

            const toolResultEntry: ChatEntry = {
              type: "tool_result",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error occurred",
              timestamp: new Date(),
              toolCall: toolCall,
              toolResult: result,
            };
            this.chatHistory.push(toolResultEntry);

            yield {
              type: "tool_result",
              toolCall,
              toolResult: result,
            };

            // Add tool result with proper format (needed for AI context)
            this.messages.push({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });
          }

          // Update token count after processing all tool calls to include tool results
          inputTokens = this.tokenCounter.countMessageTokens(
            this.messages as any
          );
          // Final token update after tools processed
          yield {
            type: "token_count",
            tokenCount: inputTokens + totalOutputTokens,
          };

          // Continue the loop to get the next response (which might have more tool calls)
        } else {
          // No tool calls, we're done
          break;
        }
      }

      if (toolRounds >= maxToolRounds) {
        yield {
          type: "content",
          content:
            "\n\nMaximum tool execution rounds reached. Stopping to prevent infinite loops.",
        };
      }

      yield { type: "done" };
    } catch (error: any) {
      // Check if this was a cancellation
      if (this.abortController?.signal.aborted) {
        yield {
          type: "content",
          content: "\n\n[Operation cancelled by user]",
        };
        yield { type: "done" };
        return;
      }

      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${error.message}`,
        timestamp: new Date(),
      };
      this.chatHistory.push(errorEntry);
      yield {
        type: "content",
        content:
          typeof errorEntry.content === "string"
            ? errorEntry.content
            : "Sorry, I encountered an error.",
      };
      yield { type: "done" };
    } finally {
      // Clean up abort controller
      this.abortController = null;
    }
  }

  private async executeTool(toolCall: GrokToolCall): Promise<ToolResult> {
    return executeToolCall(this.getToolExecutorContext(), toolCall);
  }

  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  getCurrentDirectory(): string {
    return this.bash.getCurrentDirectory();
  }

  async executeBashCommand(command: string): Promise<ToolResult> {
    return await this.bash.execute(command);
  }

  getCurrentModel(): string {
    return this.grokClient.getCurrentModel();
  }

  setModel(model: string): void {
    this.grokClient.setModel(model);
    // Update token counter for new model
    this.tokenCounter.dispose();
    this.tokenCounter = createTokenCounter(model);
  }

  abortCurrentOperation(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}
