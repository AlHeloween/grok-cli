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
      properties: Record<string, any>;
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

export interface AgentToolResponse {
  id: string;
  output_text?: string;
  output?: any[];
}

export class GrokClient {
  private client: OpenAI;
  private currentModel: string = "grok-code-fast-1";
  private defaultMaxTokens: number;

  private static isReasoningModel(model: string): boolean {
    return model.toLowerCase().includes("reasoning");
  }

  constructor(apiKey: string, model?: string, baseURL?: string) {
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
    const envMax = Number(process.env.GROK_MAX_TOKENS);
    this.defaultMaxTokens = Number.isFinite(envMax) && envMax > 0 ? envMax : 1536;
  }

  setModel(model: string): void {
    this.currentModel = model;
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  private convertMessagesToChatCompletionsFormat(messages: GrokMessage[]): any[] {
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

  async chat(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string
  ): Promise<GrokResponse> {
    try {
      const requestPayload: any = {
        model: model || this.currentModel,
        messages: this.convertMessagesToChatCompletionsFormat(messages),
        tools: tools || [],
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
        temperature: 0.7,
        max_tokens: this.defaultMaxTokens,
      };

      const response =
        await this.client.chat.completions.create(requestPayload);

      return response as GrokResponse;
    } catch (error: any) {
      throw new Error(`Grok API error: ${error.message}`);
    }
  }

  async *chatStream(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string
  ): AsyncGenerator<any, void, unknown> {
    try {
      const requestPayload: any = {
        model: model || this.currentModel,
        messages: this.convertMessagesToChatCompletionsFormat(messages),
        tools: tools || [],
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
        temperature: 0.7,
        max_tokens: this.defaultMaxTokens,
        stream: true,
      };

      const stream = (await this.client.chat.completions.create(
        requestPayload
      )) as any;

      for await (const chunk of stream) {
        yield chunk;
      }
    } catch (error: any) {
      throw new Error(`Grok API error: ${error.message}`);
    }
  }

  private convertToolsToResponsesFormat(tools?: GrokTool[]): any[] {
    return (tools || []).map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
      strict: false,
    }));
  }

  private convertMessagesToResponsesInput(messages: GrokMessage[]): any[] {
    const input: any[] = [];

    for (const message of messages) {
      const msg = message as any;
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

  async chatWithAgentTools(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string,
    includeWebSearch: boolean = true
  ): Promise<AgentToolResponse> {
    try {
      const requestTools = this.convertToolsToResponsesFormat(tools);
      if (includeWebSearch) {
        requestTools.unshift({ type: "web_search" });
      }

      const response = await this.client.responses.create({
        model: model || this.currentModel,
        input: this.convertMessagesToResponsesInput(messages),
        tools: requestTools,
        temperature: 0.7,
        max_output_tokens: this.defaultMaxTokens,
        parallel_tool_calls: true,
      } as any);

      return response as AgentToolResponse;
    } catch (error: any) {
      throw new Error(`Grok API error: ${error.message}`);
    }
  }

  async continueAgentToolsChat(
    previousResponseId: string,
    toolResults: Array<{ callId: string; output: string }>,
    tools?: GrokTool[],
    model?: string,
    includeWebSearch: boolean = true
  ): Promise<AgentToolResponse> {
    try {
      const requestTools = this.convertToolsToResponsesFormat(tools);
      if (includeWebSearch) {
        requestTools.unshift({ type: "web_search" });
      }

      const input = toolResults.map((result) => ({
        type: "function_call_output",
        call_id: result.callId,
        output: result.output,
      }));

      const response = await this.client.responses.create({
        model: model || this.currentModel,
        previous_response_id: previousResponseId,
        input,
        tools: requestTools,
        temperature: 0.7,
        max_output_tokens: this.defaultMaxTokens,
        parallel_tool_calls: true,
      } as any);

      return response as AgentToolResponse;
    } catch (error: any) {
      throw new Error(`Grok API error: ${error.message}`);
    }
  }

  async search(query: string): Promise<AgentToolResponse> {
    const searchMessage: GrokMessage = {
      role: "user",
      content: query,
    };

    return this.chatWithAgentTools([searchMessage], [], undefined, true);
  }
}
