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

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: unknown;
}

export interface Tool {
  name: string;
  description: string;
  execute: (...args: unknown[]) => Promise<ToolResult>;
}

export interface EditorCommand {
  command: 'view' | 'str_replace' | 'create' | 'insert' | 'undo_edit';
  path?: string;
  old_str?: string;
  new_str?: string;
  content?: string;
  insert_line?: number;
  view_range?: [number, number];
  replace_all?: boolean;
}

export interface AgentState {
  currentDirectory: string;
  editHistory: EditorCommand[];
  tools: Tool[];
}

export interface ConfirmationState {
  skipThisSession: boolean;
  pendingOperation: boolean;
}