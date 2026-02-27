import React from "react";
import { Box, Text, useStdout, Static } from "ink";
import { ChatEntry } from "../../agent/grok-agent.js";
import { GrokToolCall } from "../../grok/client.js";
import { DiffRenderer } from "./diff-renderer.js";
import { MarkdownRenderer } from "../utils/markdown-renderer.js";
import { useTheme } from "../context/theme-context.js";

interface ChatHistoryProps {
  entries: ChatEntry[];
  isConfirmationActive?: boolean;
}

// Memoized ChatEntry component to prevent unnecessary re-renders
const MemoizedChatEntry = React.memo(
  ({ entry, index }: { entry: ChatEntry; index: number }) => {
    const { theme } = useTheme();
    const colors = theme.colors;

    const renderUserContent = (content: ChatEntry["content"]): string => {
      if (typeof content === "string") {
        return content;
      }

      return content
        .map((part) =>
          part.type === "input_text" ? part.text : "[Image]"
        )
        .join(" ")
        .trim();
    };

    const asTextContent = (content: ChatEntry["content"]): string => {
      if (typeof content === "string") {
        return content;
      }
      return renderUserContent(content);
    };

    const renderDiff = (diffContent: string, filename?: string) => {
      return (
        <DiffRenderer
          diffContent={diffContent}
          filename={filename}
          terminalWidth={80}
        />
      );
    };

    const renderFileContent = (content: string) => {
      const lines = content.split("\n");

      // Calculate minimum indentation like DiffRenderer does
      let baseIndentation = Infinity;
      for (const line of lines) {
        if (line.trim() === "") continue;
        const firstCharIndex = line.search(/\S/);
        const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex;
        baseIndentation = Math.min(baseIndentation, currentIndent);
      }
      if (!isFinite(baseIndentation)) {
        baseIndentation = 0;
      }

      return lines.map((line, index) => {
        const displayContent = line.substring(baseIndentation);
        return (
          <Text key={index} color={colors.textDim}>
            {displayContent}
          </Text>
        );
      });
    };

    switch (entry.type) {
      case "user":
        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Box>
              <Text color={colors.userPrefix}>
                {">"} {renderUserContent(entry.content)}
              </Text>
            </Box>
          </Box>
        );

      case "assistant":
        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Box flexDirection="row" alignItems="flex-start">
              <Text color={colors.assistantPrefix}>⏺ </Text>
              <Box flexDirection="column" flexGrow={1}>
                {entry.toolCalls ? (
                  // If there are tool calls, just show plain text
                  <Text color={colors.text}>{asTextContent(entry.content).trim()}</Text>
                ) : (
                  // If no tool calls, render as markdown
                  <MarkdownRenderer content={asTextContent(entry.content).trim()} />
                )}
                {entry.isStreaming && <Text color={colors.accent}>█</Text>}
              </Box>
            </Box>
          </Box>
        );

      case "tool_call":
      case "tool_result":
        const getToolActionName = (toolName: string) => {
          // Handle MCP tools with mcp__servername__toolname format
          if (toolName.startsWith("mcp__")) {
            const parts = toolName.split("__");
            if (parts.length >= 3) {
              const serverName = parts[1];
              const actualToolName = parts.slice(2).join("__");
              return `${serverName.charAt(0).toUpperCase() + serverName.slice(1)}(${actualToolName.replace(/_/g, " ")})`;
            }
          }

          switch (toolName) {
            case "view_file":
              return "Read";
            case "str_replace_editor":
              return "Update";
            case "create_file":
              return "Create";
            case "bash":
              return "Bash";
            case "search":
              return "Search";
            case "create_todo_list":
              return "Created Todo";
            case "update_todo_list":
              return "Updated Todo";
            default:
              return "Tool";
          }
        };

        const toolName = entry.toolCall?.function?.name || "unknown";
        const actionName = getToolActionName(toolName);

        const getFilePath = (toolCall: GrokToolCall | undefined) => {
          if (toolCall?.function?.arguments) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              if (toolCall.function.name === "search") {
                return args.query;
              }
              return args.path || args.file_path || args.command || "";
            } catch {
              return "";
            }
          }
          return "";
        };

        const filePath = getFilePath(entry.toolCall);
        const isExecuting = entry.type === "tool_call" || !entry.toolResult;
        
        // Format JSON content for better readability
        const formatToolContent = (content: string, toolName: string) => {
          if (toolName.startsWith("mcp__")) {
            try {
              // Try to parse as JSON and format it
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) {
                // For arrays, show a summary instead of full JSON
                return `Found ${parsed.length} items`;
              } else if (typeof parsed === 'object') {
                // For objects, show a formatted version
                return JSON.stringify(parsed, null, 2);
              }
            } catch {
              // If not JSON, return as is
              return content;
            }
          }
          return content;
        };
        const shouldShowDiff =
          entry.toolCall?.function?.name === "str_replace_editor" &&
          entry.toolResult?.success &&
          asTextContent(entry.content).includes("Updated") &&
          asTextContent(entry.content).includes("---") &&
          asTextContent(entry.content).includes("+++");

        const shouldShowFileContent =
          (entry.toolCall?.function?.name === "view_file" ||
            entry.toolCall?.function?.name === "create_file") &&
          entry.toolResult?.success &&
          !shouldShowDiff;

        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Box>
              <Text color={colors.toolPrefix}>⏺</Text>
              <Text color={colors.text}>
                {" "}
                {filePath ? `${actionName}(${filePath})` : actionName}
              </Text>
            </Box>
            <Box marginLeft={2} flexDirection="column">
              {isExecuting ? (
                <Text color={colors.accent}>⎿ Executing...</Text>
              ) : shouldShowFileContent ? (
                <Box flexDirection="column">
                  <Text color={colors.textDim}>⎿ File contents:</Text>
                  <Box marginLeft={2} flexDirection="column">
                    {renderFileContent(asTextContent(entry.content))}
                  </Box>
                </Box>
              ) : shouldShowDiff ? (
                // For diff results, show only the summary line, not the raw content
                <Text color={colors.textDim}>
                  ⎿ {asTextContent(entry.content).split("\n")[0]}
                </Text>
              ) : (
                <Text color={colors.textDim}>
                  ⎿ {formatToolContent(asTextContent(entry.content), toolName)}
                </Text>
              )}
            </Box>
            {shouldShowDiff && !isExecuting && (
              <Box marginLeft={4} flexDirection="column">
                {renderDiff(asTextContent(entry.content), filePath)}
              </Box>
            )}
          </Box>
        );

      default:
        return null;
    }
  }
);

MemoizedChatEntry.displayName = "MemoizedChatEntry";

export const ChatHistory = React.memo(function ChatHistory({
  entries,
  isConfirmationActive = false,
}: ChatHistoryProps) {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  
  // Filter out tool_call entries with "Executing..." when confirmation is active
  const filteredEntries = React.useMemo(() => 
    isConfirmationActive
      ? entries.filter(
          (entry) =>
            !(entry.type === "tool_call" && entry.content === "Executing...")
        )
      : entries,
    [entries, isConfirmationActive]
  );

  // Calculate how many entries we can show based on terminal height
  // Conservative estimate: each entry takes ~6 lines (margins, header, content, wrapping)
  // Reserve 8 lines for other UI (input, spinner, status, borders)
  const estimatedLinesPerEntry = 6;
  const reservedLines = 8;
  const maxVisibleEntries = Math.max(1, Math.floor((terminalHeight - reservedLines) / estimatedLinesPerEntry));
  
  // Get only the last N entries that fit on screen
  const visibleEntries = filteredEntries.slice(-maxVisibleEntries);

  // Determine which entries are "live" (currently updating)
  const isLiveEntry = (entry: ChatEntry): boolean => {
    // Streaming assistant messages
    if (entry.isStreaming) return true;
    // Tool calls that are still executing
    if (entry.type === "tool_call" && entry.content === "Executing...") return true;
    // Tool results that just appeared might still be updated? No, they're final.
    return false;
  };

  // Separate static and live entries
  const staticEntries: ChatEntry[] = [];
  const liveEntries: ChatEntry[] = [];
  visibleEntries.forEach(entry => {
    if (isLiveEntry(entry)) {
      liveEntries.push(entry);
    } else {
      staticEntries.push(entry);
    }
  });

  return (
    <Box flexDirection="column">
      {/* Render static entries with Static component to prevent re-renders */}
      <Static items={staticEntries}>
        {(entry, index) => (
          <MemoizedChatEntry
            key={`${entry.timestamp.getTime()}-${index}`}
            entry={entry}
            index={index}
          />
        )}
      </Static>
      {/* Render live entries normally so they can update */}
      {liveEntries.map((entry, index) => (
        <MemoizedChatEntry
          key={`${entry.timestamp.getTime()}-${index}`}
          entry={entry}
          index={index}
        />
      ))}
    </Box>
  );
});
