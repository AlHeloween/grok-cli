import {
  AgentToolResponse,
  AgentToolResponseItem,
  AgentToolResponseFunctionCall,
  GrokClient,
  GrokMessage,
  GrokToolCall,
  GrokResponse,
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
import { ChatHistoryManager } from "./chat-history-manager.js";
import { formatRagChunksForPrompt, retrieveTopK } from "../rag/retriever.js";
import { auroraRetrieveTopK } from "../aurora/integration/rag-wrapper.js";

export interface ChatEntry {
  type: "user" | "assistant" | "tool_result" | "tool_call";
  content: string | UserContentPart[];
  timestamp: Date;
  toolCalls?: GrokToolCall[];
  toolCall?: GrokToolCall;
  toolResult?: { success: boolean; output?: string; error?: string };
  isStreaming?: boolean;
  // ADID State Vector tracking fields
  svHash?: string;               // md5_sv_tag - semantic anchor hash
  msgHash?: string;              // md5_msg_tag - provenance hash of the message content
  prevSVHashes?: string[];       // previous semantic anchor hashes (semantic_link)
  semanticDominant?: string;     // dominant keyword(s)
  semanticVector?: Array<{keyword: string; weight: number}>; // keyword-weight pairs
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
private chatHistoryManager: ChatHistoryManager;
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
  this.chatHistoryManager.trimIfNeeded();
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
    this.chatHistoryManager = new ChatHistoryManager();
    this.tokenCounter = createTokenCounter(modelToUse);

    // Initialize MCP servers if configured
    this.initializeMCP();

    // Initialize with system message
    const customInstructions = loadCustomInstructions();
    this.baseSystemPrompt = getSystemPrompt({
      hasMorphEditor: !!this.morphEditor,
      customInstructions: customInstructions ?? undefined,
    });
    this.chatHistoryManager.addMessage({ role: "system", content: this.baseSystemPrompt });
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
    if (this.chatHistoryManager.getMessages()[0]?.role === "system") {
      this.chatHistoryManager.getMessages()[0].content = this.baseSystemPrompt;
    }
  }

  private async maybeInjectRagContext(userMessageText: string): Promise<void> {
    // Always reset system prompt each turn to avoid accumulating context.
    if (this.chatHistoryManager.getMessages()[0]?.role === "system") {
      this.chatHistoryManager.getMessages()[0].content = this.baseSystemPrompt;
    }

    const settings = getSettingsManager();
    const debug = process.env.GROK_DEBUG_RAG === "1";
    if (!settings.isRagEnabled()) {
      if (debug) console.log("[RAG] RAG not enabled");
      return;
    }

    try {
      const baseOptions = {
        cwd: process.cwd(),
        topK: settings.getRagTopK(),
        useKMedoids: settings.getRagUseKMedoids(),
        candidateCount: settings.getRagCandidateCount(),
        searchChatFirst: settings.getRagSearchChatFirst(),
        chatPrefix: settings.getRagChatPrefix(),
      };

      if (debug) console.log(`[RAG] Retrieving context for: ${userMessageText.substring(0, 100)}...`);
      let rows;
      if (settings.getRagAuroraEnabled()) {
        rows = await auroraRetrieveTopK(userMessageText, {
          ...baseOptions,
          useFractalQuantization: settings.getRagAuroraFractalQuantization(),
          useDualQuaternionDistance: settings.getRagAuroraDualQuaternionDistance(),
          useGloveKeywords: settings.getRagAuroraGloveKeywords(),
        });
      } else {
        rows = await retrieveTopK(userMessageText, baseOptions);
      }
      if (!rows.length) {
        if (debug) console.log("[RAG] No chunks retrieved");
        return;
      }
      if (debug) console.log(`[RAG] Retrieved ${rows.length} chunks`);

      const formatted = formatRagChunksForPrompt(rows);
      if (!formatted) {
        if (debug) console.log("[RAG] No formatted context");
        return;
      }
      if (debug) console.log(`[RAG] Formatted context length: ${formatted.length}`);

      if (this.chatHistoryManager.getMessages()[0]?.role === "system") {
        this.chatHistoryManager.getMessages()[0].content =
          this.baseSystemPrompt +
          "\n\nRELEVANT PROJECT CONTEXT (use when answering; prefer citing file paths):\n" +
          formatted;
        if (debug) {
          const systemMsg = this.chatHistoryManager.getMessages()[0];
          const content = systemMsg.content;
          if (typeof content === 'string') {
            console.log(`[RAG] System message length: ${content.length}`);
            const hasContext = content.includes('RELEVANT PROJECT CONTEXT');
            console.log(`[RAG] Contains context marker: ${hasContext}`);
            if (hasContext) {
              const contextIndex = content.indexOf('RELEVANT PROJECT CONTEXT');
              console.log(`[RAG] Context starts at index: ${contextIndex}`);
              // Show 200 chars before and after the marker
              const start = Math.max(0, contextIndex - 100);
              const end = Math.min(content.length, contextIndex + 300);
              console.log(`[RAG] Context snippet:\n${content.substring(start, end)}...`);
            }
            console.log(`[RAG] First 500 chars:\n${content.substring(0, 500)}...`);
            console.log(`[RAG] Last 500 chars:\n${content.substring(Math.max(0, content.length - 500))}...`);
          } else {
            console.log(`[RAG] System message content is not a string: ${typeof content}`);
          }
        }
      }
    } catch (error) {
      // Best-effort only: if RAG fails, proceed without it.
      if (debug) console.error("[RAG] Error:", error);
      if (this.chatHistoryManager.getMessages()[0]?.role === "system") {
        this.chatHistoryManager.getMessages()[0].content = this.baseSystemPrompt;
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
    const output = (Array.isArray(response.output) ? response.output : []) as AgentToolResponseItem[];
    return output
      .filter((item): item is AgentToolResponseFunctionCall => item?.type === "function_call" && item?.name != null)
      .map((item) => ({
        id: item.call_id || item.id || `call_${Date.now()}`,
        type: "function" as const,
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
    const output = (Array.isArray(response.output) ? response.output : []) as AgentToolResponseItem[];
    const messageTexts: string[] = [];
    for (const item of output) {
      if (item.type === "message" && Array.isArray(item.content)) {
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
    }
    return messageTexts.join("\n").trim();
  }

  async processUserMessage(message: UserContent): Promise<ChatEntry[]> {
    const messageText = this.getUserContentText(message);
    // Inject RAG context before processing
    await this.maybeInjectRagContext(messageText);
    // Add user message to conversation
    const userEntry: ChatEntry = {
      type: "user",
      content: message,
      timestamp: new Date(),
    };
    this.chatHistoryManager.addChatEntry(userEntry);
    this.chatHistoryManager.addMessage({ role: "user", content: message });
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
            this.chatHistoryManager.getMessages(),
            tools,
            undefined,
            includeWebSearch
          )
        : await this.grokClient.chat(this.chatHistoryManager.getMessages(), tools, undefined);

      // Agent loop - continue until no more tool calls or max rounds reached
      while (toolRounds < maxToolRounds) {
        this.trimHistoryIfNeeded();
        const assistantMessage = useAgentTools
          ? {
              content: this.getAgentAssistantText(currentResponse as AgentToolResponse),
              tool_calls: this.getAgentToolCalls(currentResponse as AgentToolResponse),
            }
          : (currentResponse as GrokResponse).choices?.[0]?.message;

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
          this.chatHistoryManager.addChatEntry(assistantEntry);
          newEntries.push(assistantEntry);

          // Add assistant message to conversation
          this.chatHistoryManager.addMessage({
            role: "assistant",
            content: assistantMessage.content || "",
            tool_calls: assistantMessage.tool_calls,
          } as GrokMessage);

          // Create initial tool call entries to show tools are being executed
          assistantMessage.tool_calls.forEach((toolCall: GrokToolCall) => {
            const toolCallEntry: ChatEntry = {
              type: "tool_call",
              content: "Executing...",
              timestamp: new Date(),
              toolCall: toolCall,
            };
            this.chatHistoryManager.addChatEntry(toolCallEntry);
            newEntries.push(toolCallEntry);
          });

          // Execute tool calls and update the entries
          const toolResultsForAgentTools: Array<{ callId: string; output: string }> =
            [];
          for (const toolCall of assistantMessage.tool_calls) {
            const result = await this.executeTool(toolCall);

            // Update the existing tool_call entry with the result
            const entryIndex = this.chatHistoryManager.findChatEntryIndex(
              (entry) =>
                entry.type === "tool_call" && entry.toolCall?.id === toolCall.id
            );

            if (entryIndex !== -1) {
              const updatedEntry: ChatEntry = {
                ...this.chatHistoryManager.getChatHistory()[entryIndex],
                type: "tool_result",
                content: result.success
                  ? result.output || "Success"
                  : result.error || "Error occurred",
                toolResult: result,
              };
              this.chatHistoryManager.updateChatEntry(entryIndex, updatedEntry);

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
            this.chatHistoryManager.addMessage({
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
              this.chatHistoryManager.getMessages(),
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
          this.chatHistoryManager.addChatEntry(finalEntry);
          this.chatHistoryManager.addMessage({
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
        this.chatHistoryManager.addChatEntry(warningEntry);
        newEntries.push(warningEntry);
      }

      return newEntries;
    } catch (error: unknown) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      };
      this.chatHistoryManager.addChatEntry(errorEntry);
      return [userEntry, errorEntry];
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private messageReducer(previous: any, item: any): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          const accArray = acc[key] as unknown[];
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
      this.chatHistoryManager.getMessages(),
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
      this.chatHistoryManager.addMessage({
        role: "assistant",
        content: assistantContent || "",
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      } as GrokMessage);

      this.chatHistoryManager.addChatEntry({
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

        this.chatHistoryManager.addMessage({
          role: "tool",
          content: outputText,
          tool_call_id: toolCall.id,
        });

        this.chatHistoryManager.addChatEntry({
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

      inputTokens = this.tokenCounter.countMessageTokens(this.chatHistoryManager.getMessages());
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
    this.chatHistoryManager.addChatEntry(userEntry);
    this.chatHistoryManager.addMessage({ role: "user", content: message });
    this.trimHistoryIfNeeded();

    // Calculate input tokens
    let inputTokens = this.tokenCounter.countMessageTokens(this.chatHistoryManager.getMessages());
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
      } catch (error: unknown) {
        if (this.abortController?.signal.aborted) {
          yield {
            type: "content",
            content: "\n\n[Operation cancelled by user]",
          };
          yield { type: "done" };
        } else {
          const errorEntry: ChatEntry = {
            type: "assistant",
            content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: new Date(),
          };
          this.chatHistoryManager.addChatEntry(errorEntry);
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
          this.chatHistoryManager.getMessages(),
          tools,
          undefined,
          this.abortController?.signal
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
               (tc: GrokToolCall) => tc.function?.name
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
        this.chatHistoryManager.addChatEntry(assistantEntry);

        // Add accumulated message to conversation
        this.chatHistoryManager.addMessage({
          role: "assistant",
          content: accumulatedMessage.content || "",
          tool_calls: accumulatedMessage.tool_calls as GrokToolCall[],
        } as GrokMessage);

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
            this.chatHistoryManager.addChatEntry(toolResultEntry);

            yield {
              type: "tool_result",
              toolCall,
              toolResult: result,
            };

            // Add tool result with proper format (needed for AI context)
            this.chatHistoryManager.addMessage({
              role: "tool",
              content: result.success
                ? result.output || "Success"
                : result.error || "Error",
              tool_call_id: toolCall.id,
            });
          }

          // Update token count after processing all tool calls to include tool results
          inputTokens = this.tokenCounter.countMessageTokens(this.chatHistoryManager.getMessages());
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
    } catch (error: unknown) {
      // Check if this was a cancellation
      if (this.abortController?.signal.aborted) {
        yield {
          type: "content",
          content: "\n\n[Operation cancelled by user]",
        };
        yield { type: "done" };
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date(),
      };
      this.chatHistoryManager.addChatEntry(errorEntry);
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
    return this.chatHistoryManager.getChatHistory();
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

  /** Load a saved chat session by session ID */
  async loadChatSession(sessionId: string): Promise<void> {
    await this.chatHistoryManager.loadSession(sessionId);
  }
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/agent/grok-agent.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/agent/grok-agent.ts.backup_20260301T124248_792029"
//   "created_at": "2026-03-01T04:42:48.809564+00:00"
//   "backup_hash": "0304d4ebdbee70e62653f5f70336e5db"
//   "new_hash": "619e1d8ed5399d281faaeb71faa1ce3b"
//   "goal_id": "extend_chatentry_adid_fields"
//   "semantics": "Extend ChatEntry interface with ADID State Vector tracking fields"
//   "update_attrs": {"relative_path": "src/agent/grok-agent.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "export interface ChatEntry {\n  type: \"user\" | \"assistant\" | \"tool_result\" | \"tool_call\";\n  content: string | UserContentPart[];\n  timestamp: Date;\n  toolCalls?: GrokToolCall[];\n  toolCall?: GrokToolCall;\n  toolResult?: { success: boolean; output?: string; error?: string };\n  isStreaming?: boolean;\n}", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/agent/grok-agent.ts\""
// }
