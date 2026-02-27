import OpenAI from "openai";

export type UserContentPart =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail?: "low" | "high" | "auto";
    };

export type UserContent = string | UserContentPart[];

type _ResponseInputItem =
  | { type: "function_call_output"; call_id: string; output: string }
  | { type: "message"; role: "system" | "developer" | "user" | "assistant"; content: string | UserContentPart[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string };

export interface GrokMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | UserContentPart[] | null;
  tool_calls?: GrokToolCall[];
  tool_call_id?: string;
}

export interface GrokTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface GrokToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface GrokResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: GrokToolCall[];
    };
    finish_reason: string;
  }>;
}

export interface AgentToolResponseContentPart {
  type: "output_text" | "text" | "image_url" | "input_text" | "input_image";
  text?: string;
  image_url?: { url: string };
}

export interface AgentToolResponseMessage {
  type: "message";
  content: AgentToolResponseContentPart[];
}

export interface AgentToolResponseFunctionCall {
  type: "function_call";
  name: string;
  call_id?: string;
  id?: string;
  arguments?: string;
}

export type AgentToolResponseItem = AgentToolResponseMessage | AgentToolResponseFunctionCall;

export interface AgentToolResponse {
  id: string;
  output_text?: string;
  output?: AgentToolResponseItem[];
}

interface WebSearchTool {
  type: "web_search";
}

interface FunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  strict: boolean;
}

type ResponseTool = WebSearchTool | FunctionTool;



/**
 * Client for the Grok API (X.AI). Supports legacy Chat Completions and the Responses API with Agent Tools (e.g. web search).
 */
/** Default model when none is specified (4.1 Fast non-reasoning for balance of speed and capability). */
const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class GrokClient {
  private client: OpenAI;
  private currentModel: string = DEFAULT_MODEL;
  private defaultMaxTokens: number;

  private static isReasoningModel(model: string): boolean {
    return model.toLowerCase().includes("reasoning");
  }

  private static isGrok41FastModel(model: string): boolean {
    return model.toLowerCase().includes("grok-4-1-fast");
  }

  private getMaxOutputTokens(model: string): number {
    const m = model || this.currentModel;
    if (GrokClient.isGrok41FastModel(m)) {
      return 8192;
    }
    return this.defaultMaxTokens;
  }

  /**
   * @param apiKey - X.AI API key
   * @param model - Optional model id (default grok-4-1-fast-non-reasoning)
   * @param baseURL - Optional base URL (default from GROK_BASE_URL or https://api.x.ai/v1)
   * @param maxTokens - Optional max output tokens override (chat.completions)
   */
  constructor(apiKey: string, model?: string, baseURL?: string, maxTokens?: number) {
    const selectedModel = model || this.currentModel;
    this.currentModel = selectedModel;
    const timeout = GrokClient.isReasoningModel(selectedModel)
      ? 3_600_000
      : 360_000;

    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL || process.env.GROK_BASE_URL || "https://api.x.ai/v1",
      timeout,
    });
    const parsed = Number(maxTokens);
    if (Number.isFinite(parsed) && parsed > 0) {
      this.defaultMaxTokens = parsed;
    } else {
      const envMax = Number(process.env.GROK_MAX_TOKENS);
      this.defaultMaxTokens =
        Number.isFinite(envMax) && envMax > 0 ? envMax : 1536;
    }
  }

  /** Set the model used for subsequent requests. */
  setModel(model: string): void {
    this.currentModel = model;
  }

  /** Return the currently selected model id. */
  getCurrentModel(): string {
    return this.currentModel;
  }

  private convertMessagesToChatCompletionsFormat(messages: GrokMessage[]): unknown[] {
    return messages.map((message) => {
      if (!Array.isArray(message.content)) {
        return message;
      }

      if (message.role !== "user") {
        return {
          ...message,
          content: JSON.stringify(message.content),
        };
      }

      const multimodalContent = message.content.map((part) => {
        if (part.type === "input_text") {
          return {
            type: "text",
            text: part.text,
          };
        }

        return {
          type: "image_url",
          image_url: {
            url: part.image_url,
          },
        };
      });

      return {
        ...message,
        content: multimodalContent,
      };
    });
  }

  /**
   * Legacy Chat Completions API. Does not support web search (no search_parameters).
   * For web search, use chatWithAgentTools/continueAgentToolsChat (Responses API + web_search tool).
   * @param signal - Optional AbortSignal to cancel the request (e.g. when user cancels).
   */
  async chat(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string,
    signal?: AbortSignal
  ): Promise<GrokResponse> {
    try {
      const requestPayload: OpenAI.ChatCompletionCreateParamsNonStreaming & { signal?: AbortSignal } = {
        model: model || this.currentModel,
        messages: this.convertMessagesToChatCompletionsFormat(messages) as OpenAI.ChatCompletionMessageParam[],
        tools: tools || [],
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
        temperature: 0.7,
        max_tokens: this.defaultMaxTokens,
        ...(signal && { signal }),
      };

      const response =
        await this.client.chat.completions.create(requestPayload);

      return response as GrokResponse;
    } catch (error: unknown) {
      throw new Error(`Grok API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * @param signal - Optional AbortSignal to cancel the stream (e.g. when user cancels).
   */
  async *chatStream(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string,
    signal?: AbortSignal
  ): AsyncGenerator<OpenAI.ChatCompletionChunk, void, unknown> {
    try {
      const requestPayload: OpenAI.ChatCompletionCreateParams & { signal?: AbortSignal } = {
        model: model || this.currentModel,
        messages: this.convertMessagesToChatCompletionsFormat(messages) as OpenAI.ChatCompletionMessageParam[],
        tools: tools || [],
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
        temperature: 0.7,
        max_tokens: this.defaultMaxTokens,
        stream: true,
        ...(signal && { signal }),
      };

      const stream = await this.client.chat.completions.create(
        requestPayload
      );

      for await (const chunk of stream) {
        yield chunk;
      }
    } catch (error: unknown) {
      throw new Error(`Grok API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private convertToolsToResponsesFormat(tools?: GrokTool[]): ResponseTool[] {
    return (tools || []).map((tool) => ({
      type: "function" as const,
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
      strict: false,
    }));
  }

  private convertMessagesToResponsesInput(messages: GrokMessage[]): unknown[] {
    const input: unknown[] = [];

    for (const message of messages) {
      const msg = message;
      const role = msg.role;

      if (role === "tool" && msg.tool_call_id) {
        const output =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content ?? "");
        input.push({
          type: "function_call_output",
          call_id: msg.tool_call_id,
          output,
        });
        continue;
      }

      const content = Array.isArray(msg.content)
        ? msg.content.map((part: UserContentPart) =>
            part.type === "input_text"
              ? { type: "input_text", text: part.text }
              : {
                  type: "input_image",
                  image_url: part.image_url,
                  detail: part.detail || "high",
                }
          )
        : typeof msg.content === "string"
          ? msg.content
          : msg.content == null
            ? ""
            : JSON.stringify(msg.content);

      if (
        role === "system" ||
        role === "developer" ||
        role === "user" ||
        role === "assistant"
      ) {
        input.push({
          type: "message",
          role,
          content,
        });
      }

      if (role === "assistant" && Array.isArray(msg.tool_calls)) {
        for (const toolCall of msg.tool_calls) {
          input.push({
            type: "function_call",
            call_id: toolCall.id,
            name: toolCall.function?.name,
            arguments: toolCall.function?.arguments || "{}",
          });
        }
      }
    }

    return input;
  }

  /**
   * Start a conversation using the Responses API with optional tools and web search.
   * @param includeWebSearch - When true, adds the web_search tool so the model can search the web.
   * @param signal - Optional AbortSignal to cancel the request.
   */
  async chatWithAgentTools(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string,
    includeWebSearch: boolean = true,
    signal?: AbortSignal
  ): Promise<AgentToolResponse> {
    try {
      const requestTools = this.convertToolsToResponsesFormat(tools);
      if (includeWebSearch) {
        requestTools.unshift({ type: "web_search" as const });
      }

      const currentModel = model || this.currentModel;
      const payload: Record<string, unknown> = {
        model: currentModel,
        input: this.convertMessagesToResponsesInput(messages),
        tools: requestTools,
        temperature: 0.7,
        max_output_tokens: this.getMaxOutputTokens(currentModel),
        parallel_tool_calls: true,
        ...(signal && { signal }),
      };
      if (GrokClient.isReasoningModel(currentModel)) {
        payload.include = ["reasoning.encrypted_content"] as const;
      }
      const response = await this.client.responses.create(payload);

      return response as AgentToolResponse;
    } catch (error: unknown) {
      throw new Error(`Grok API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Continue an Agent Tools conversation with tool results (Responses API).
   * @param previousResponseId - Id from the previous chatWithAgentTools or continueAgentToolsChat response.
   * @param includeWebSearch - When true, web_search remains available for follow-up.
   * @param signal - Optional AbortSignal to cancel the request.
   */
  async continueAgentToolsChat(
    previousResponseId: string,
    toolResults: Array<{ callId: string; output: string }>,
    tools?: GrokTool[],
    model?: string,
    includeWebSearch: boolean = true,
    signal?: AbortSignal
  ): Promise<AgentToolResponse> {
    try {
      const requestTools = this.convertToolsToResponsesFormat(tools);
      if (includeWebSearch) {
        requestTools.unshift({ type: "web_search" as const });
      }

      const input: OpenAI.Responses.ResponseInput = toolResults.map((result) => ({
        type: "function_call_output" as const,
        call_id: result.callId,
        output: result.output,
      }));

      const currentModel = model || this.currentModel;
      const payload: Record<string, unknown> = {
        model: currentModel,
        previous_response_id: previousResponseId,
        input,
        tools: requestTools,
        temperature: 0.7,
        max_output_tokens: this.getMaxOutputTokens(currentModel),
        parallel_tool_calls: true,
        ...(signal && { signal }),
      };
      if (GrokClient.isReasoningModel(currentModel)) {
        payload.include = ["reasoning.encrypted_content"] as const;
      }
      const response = await this.client.responses.create(payload);

      return response as AgentToolResponse;
    } catch (error: unknown) {
      throw new Error(`Grok API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Run a single query with web search enabled (convenience wrapper around chatWithAgentTools). */
  async search(query: string): Promise<AgentToolResponse> {
    const searchMessage: GrokMessage = {
      role: "user",
      content: query,
    };

    return this.chatWithAgentTools([searchMessage], [], undefined, true);
  }
}
