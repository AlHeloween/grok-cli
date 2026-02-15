import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/theme-context.js";

interface ModelOption {
  model: string;
}

interface ModelSelectionProps {
  models: ModelOption[];
  selectedIndex: number;
  isVisible: boolean;
  currentModel: string;
}

export function ModelSelection({
  models,
  selectedIndex,
  isVisible,
  currentModel,
}: ModelSelectionProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  if (!isVisible) return null;

  return (
    <Box marginTop={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text color={colors.accent}>Select Grok Model (current: {currentModel}):</Text>
      </Box>
      {models.map((modelOption, index) => (
        <Box key={index} paddingLeft={1}>
          <Text
            color={index === selectedIndex ? colors.selectionFg : colors.text}
            backgroundColor={index === selectedIndex ? colors.selectionBg : undefined}
          >
            {modelOption.model}
          </Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={colors.textDim} dimColor>
          ↑↓ navigate • Enter/Tab select • Esc cancel
        </Text>
      </Box>
    </Box>
  );
}