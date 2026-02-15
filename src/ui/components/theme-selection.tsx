import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/theme-context.js";

interface ThemeOption {
  id: string;
  name: string;
}

interface ThemeSelectionProps {
  themes: ThemeOption[];
  selectedIndex: number;
  isVisible: boolean;
  currentThemeId: string;
}

export function ThemeSelection({
  themes,
  selectedIndex,
  isVisible,
  currentThemeId,
}: ThemeSelectionProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  if (!isVisible) return null;

  const nameWidth = themes.reduce((max, t) => Math.max(max, t.name.length), 0);
  const idWidth = themes.reduce((max, t) => Math.max(max, t.id.length), 0);

  return (
    <Box marginTop={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text color={colors.accent}>
          Select Theme (current: {currentThemeId}):
        </Text>
      </Box>
      {themes.map((t, index) => (
        <Box key={t.id} paddingLeft={1}>
          <Text
            color={index === selectedIndex ? colors.selectionFg : colors.text}
            backgroundColor={
              index === selectedIndex ? colors.selectionBg : undefined
            }
          >
            {t.name.padEnd(nameWidth, " ")}  {t.id.padEnd(idWidth, " ")}
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

