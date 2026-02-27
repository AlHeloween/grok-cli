import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/theme-context.js";

interface ChatInputProps {
  input: string;
  cursorPosition: number;
  isProcessing: boolean;
  isStreaming: boolean;
  pendingImageCount?: number;
  placeholderText?: string;
  maskInput?: boolean;
}

export const ChatInput = React.memo(function ChatInput({
  input,
  cursorPosition,
  isProcessing,
  isStreaming,
  pendingImageCount = 0,
  placeholderText = "Ask me anything...",
  maskInput = false,
}: ChatInputProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const display = maskInput && input ? "•".repeat(input.length) : input;
  const beforeCursor = display.slice(0, cursorPosition);
  const _afterCursor = input.slice(cursorPosition);

  // Handle multiline input display
  const lines = display.split("\n");
  const isMultiline = lines.length > 1;

  // Calculate cursor position across lines
  let currentLineIndex = 0;
  let currentCharIndex = 0;
  let totalChars = 0;

  for (let i = 0; i < lines.length; i++) {
    if (totalChars + lines[i].length >= cursorPosition) {
      currentLineIndex = i;
      currentCharIndex = cursorPosition - totalChars;
      break;
    }
    totalChars += lines[i].length + 1; // +1 for newline
  }

  const showCursor = !isProcessing && !isStreaming;
  const borderColor = isProcessing || isStreaming ? colors.borderActive : colors.border;
  const promptColor = colors.prompt;

  // Display placeholder when input is empty
  const isPlaceholder = !display;

  if (isMultiline) {
    return (
      <Box flexDirection="column" marginTop={1}>
        {pendingImageCount > 0 && (
          <Text color={colors.warning}>
            {pendingImageCount} image{pendingImageCount === 1 ? "" : "s"} attached
          </Text>
        )}
        <Box borderStyle="round" borderColor={borderColor} paddingY={0}>
          {lines.map((line, index) => {
            const isCurrentLine = index === currentLineIndex;
            const promptChar = index === 0 ? "❯" : "│";

            if (isCurrentLine) {
              const beforeCursorInLine = line.slice(0, currentCharIndex);
              const cursorChar =
                line.slice(currentCharIndex, currentCharIndex + 1) || " ";
              const afterCursorInLine = line.slice(currentCharIndex + 1);

              return (
                <Box key={index}>
                  <Text color={promptColor}>{promptChar} </Text>
                  <Text>
                    {beforeCursorInLine}
                    {showCursor && (
                      <Text backgroundColor={colors.cursorBg} color={colors.cursorFg}>
                        {cursorChar}
                      </Text>
                    )}
                    {!showCursor && cursorChar !== " " && cursorChar}
                    {afterCursorInLine}
                  </Text>
                </Box>
              );
            } else {
              return (
                <Box key={index}>
                  <Text color={promptColor}>{promptChar} </Text>
                  <Text>{line}</Text>
                </Box>
              );
            }
          })}
        </Box>
      </Box>
    );
  }

  // Single line input box
  const cursorChar = display.slice(cursorPosition, cursorPosition + 1) || " ";
  const afterCursorText = display.slice(cursorPosition + 1);

  return (
    <Box flexDirection="column" marginTop={1}>
      {pendingImageCount > 0 && (
          <Text color={colors.warning}>
          {pendingImageCount} image{pendingImageCount === 1 ? "" : "s"} attached
        </Text>
      )}
      <Box borderStyle="round" borderColor={borderColor} paddingX={1} paddingY={0}>
        <Box>
          <Text color={promptColor}>❯ </Text>
          {isPlaceholder ? (
            <>
              <Text color={colors.textDim} dimColor>
                {placeholderText}
              </Text>
              {showCursor && (
                <Text backgroundColor={colors.cursorBg} color={colors.cursorFg}>
                  {" "}
                </Text>
              )}
            </>
          ) : (
            <Text>
              {beforeCursor}
              {showCursor && (
                <Text backgroundColor={colors.cursorBg} color={colors.cursorFg}>
                  {cursorChar}
                </Text>
              )}
              {!showCursor && cursorChar !== " " && cursorChar}
              {afterCursorText}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
});

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/ui/components/chat-input.tsx"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/ui/components/chat-input.tsx.backup_20260227T195119_746276"
//   "created_at": "2026-02-27T11:51:19.764353+00:00"
//   "backup_hash": "7b8059c006af60d83f32fc11ba9f8fe4"
//   "new_hash": "c458dd91054a6207eab80f1a8a73acee"
//   "goal_id": "chatinput_memoize"
//   "semantics": "Wrap ChatInput with React.memo to reduce re-renders"
//   "update_attrs": {"relative_path": "src/ui/components/chat-input.tsx", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "export function ChatInput({\n  input,\n  cursorPosition,\n  isProcessing,\n  isStreaming,\n  pendingImageCount = 0,\n  placeholderText = \"Ask me anything...\",\n  maskInput = false,\n}: ChatInputProps) {\n  const { theme } = useTheme();\n  const colors = theme.colors;\n  const display = maskInput && input ? \"•\".repeat(input.length) : input;\n  const beforeCursor = display.slice(0, cursorPosition);\n  const _afterCursor = input.slice(cursorPosition);\n\n  // Handle multiline input display\n  const lines = display.split(\"\\n\");\n  const isMultiline = lines.length > 1;\n\n  // Calculate cursor position across lines\n  let currentLineIndex = 0;\n  let currentCharIndex = 0;\n  let totalChars = 0;\n\n  for (let i = 0; i < lines.length; i++) {\n    if (totalChars + lines[i].length >= cursorPosition) {\n      currentLineIndex = i;\n      currentCharIndex = cursorPosition - totalChars;\n      break;\n    }\n    totalChars += lines[i].length + 1; // +1 for newline\n  }\n\n  const showCursor = !isProcessing && !isStreaming;\n  const borderColor = isProcessing || isStreaming ? colors.borderActive : colors.border;\n  const promptColor = colors.prompt;\n\n  // Display placeholder when input is empty\n  const isPlaceholder = !display;\n\n  if (isMultiline) {\n    return (\n      <Box flexDirection=\"column\" marginTop={1}>\n        {pendingImageCount > 0 && (\n          <Text color={colors.warning}>\n            {pendingImageCount} image{pendingImageCount === 1 ? \"\" : \"s\"} attached\n          </Text>\n        )}\n        <Box borderStyle=\"round\" borderColor={borderColor} paddingY={0}>\n          {lines.map((line, index) => {\n            const isCurrentLine = index === currentLineIndex;\n            const promptChar = index === 0 ? \"❯\" : \"│\";\n\n            if (isCurrentLine) {\n              const beforeCursorInLine = line.slice(0, currentCharIndex);\n              const cursorChar =\n                line.slice(currentCharIndex, currentCharIndex + 1) || \" \";\n              const afterCursorInLine = line.slice(currentCharIndex + 1);\n\n              return (\n                <Box key={index}>\n                  <Text color={promptColor}>{promptChar} </Text>\n                  <Text>\n                    {beforeCursorInLine}\n                    {showCursor && (\n                      <Text backgroundColor={colors.cursorBg} color={colors.cursorFg}>\n                        {cursorChar}\n                      </Text>\n                    )}\n                    {!showCursor && cursorChar !== \" \" && cursorChar}\n                    {afterCursorInLine}\n                  </Text>\n                </Box>\n              );\n            } else {\n              return (\n                <Box key={index}>\n                  <Text color={promptColor}>{promptChar} </Text>\n                  <Text>{line}</Text>\n                </Box>\n              );\n            }\n          })}\n        </Box>\n      </Box>\n    );\n  }\n\n  // Single line input box\n  const cursorChar = display.slice(cursorPosition, cursorPosition + 1) || \" \";\n  const afterCursorText = display.slice(cursorPosition + 1);\n\n  return (\n    <Box flexDirection=\"column\" marginTop={1}>\n      {pendingImageCount > 0 && (\n          <Text color={colors.warning}>\n          {pendingImageCount} image{pendingImageCount === 1 ? \"\" : \"s\"} attached\n        </Text>\n      )}\n      <Box borderStyle=\"round\" borderColor={borderColor} paddingX={1} paddingY={0}>\n        <Box>\n          <Text color={promptColor}>❯ </Text>\n          {isPlaceholder ? (\n            <>\n              <Text color={colors.textDim} dimColor>\n                {placeholderText}\n              </Text>\n              {showCursor && (\n                <Text backgroundColor={colors.cursorBg} color={colors.cursorFg}>\n                  {\" \"}\n                </Text>\n              )}\n            </>\n          ) : (\n            <Text>\n              {beforeCursor}\n              {showCursor && (\n                <Text backgroundColor={colors.cursorBg} color={colors.cursorFg}>\n                  {cursorChar}\n                </Text>\n              )}\n              {!showCursor && cursorChar !== \" \" && cursorChar}\n              {afterCursorText}\n            </Text>\n          )}\n        </Box>\n      </Box>\n    </Box>\n  );\n}", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/ui/components/chat-input.tsx\""
// }
