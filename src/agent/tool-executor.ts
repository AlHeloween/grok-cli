import { GrokToolCall } from "../grok/client.js";
import { TextEditorTool } from "../tools/text-editor.js";
import type { MorphEditorTool } from "../tools/morph-editor.js";
import { BashTool } from "../tools/bash.js";
import { TodoTool } from "../tools/todo-tool.js";
import { SearchTool } from "../tools/search.js";
import { getMCPManager } from "../grok/tools.js";
import { ToolResult } from "../types/index.js";

export interface ToolExecutorContext {
  textEditor: TextEditorTool;
  morphEditor: MorphEditorTool | null;
  bash: BashTool;
  todoTool: TodoTool;
  search: SearchTool;
}

/**
 * Execute a single tool call and return the result.
 */
export async function executeTool(
  context: ToolExecutorContext,
  toolCall: GrokToolCall
): Promise<ToolResult> {
  const { textEditor, morphEditor, bash, todoTool, search } = context;
  try {
    const args = JSON.parse(toolCall.function.arguments);

    switch (toolCall.function.name) {
      case "view_file": {
        const range: [number, number] | undefined =
          args.start_line && args.end_line
            ? [args.start_line, args.end_line]
            : undefined;
        return await textEditor.view(args.path, range);
      }

      case "create_file":
        return await textEditor.create(args.path, args.content);

      case "str_replace_editor":
        return await textEditor.strReplace(
          args.path,
          args.old_str,
          args.new_str,
          args.replace_all
        );

      case "edit_file":
        if (!morphEditor) {
          return {
            success: false,
            error:
              "Morph Fast Apply not available. Please set MORPH_API_KEY environment variable to use this feature.",
          };
        }
        return await morphEditor.editFile(
          args.target_file,
          args.instructions,
          args.code_edit
        );

      case "bash":
        return await bash.execute(args.command);

      case "create_todo_list":
        return await todoTool.createTodoList(args.todos);

      case "update_todo_list":
        return await todoTool.updateTodoList(args.updates);

      case "search":
        return await search.search(args.query, {
          searchType: args.search_type,
          includePattern: args.include_pattern,
          excludePattern: args.exclude_pattern,
          caseSensitive: args.case_sensitive,
          wholeWord: args.whole_word,
          regex: args.regex,
          maxResults: args.max_results,
          fileTypes: args.file_types,
          includeHidden: args.include_hidden,
        });

      default:
        if (toolCall.function.name.startsWith("mcp__")) {
          return await executeMCPTool(toolCall);
        }
        return {
          success: false,
          error: `Unknown tool: ${toolCall.function.name}`,
        };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Tool execution error: ${message}`,
    };
  }
}

async function executeMCPTool(toolCall: GrokToolCall): Promise<ToolResult> {
  try {
    const args = JSON.parse(toolCall.function.arguments);
    const mcpManager = getMCPManager();

    const result = await mcpManager.callTool(toolCall.function.name, args);

    if (result.isError) {
      return {
        success: false,
        error:
          (result.content[0] as { text?: string } | undefined)?.text ||
          "MCP tool error",
      };
    }

    const output = result.content
      .map((item: { type?: string; text?: string; resource?: { uri?: string } }) => {
        if (item.type === "text") {
          return item.text;
        }
        if (item.type === "resource") {
          return `Resource: ${item.resource?.uri ?? "Unknown"}`;
        }
        return String(item);
      })
      .join("\n");

    return {
      success: true,
      output: output || "Success",
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `MCP tool execution error: ${message}`,
    };
  }
}
