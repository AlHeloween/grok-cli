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

export function ChatInput({
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
}
