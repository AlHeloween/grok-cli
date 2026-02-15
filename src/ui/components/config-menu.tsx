import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/theme-context.js";

export interface ConfigMenuItem {
  id: string;
  label: string;
  value?: string;
  hint?: string;
}

interface ConfigMenuProps {
  title: string;
  items: ConfigMenuItem[];
  selectedIndex: number;
  isVisible: boolean;
}

export function ConfigMenu({
  title,
  items,
  selectedIndex,
  isVisible,
}: ConfigMenuProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  if (!isVisible) return null;

  const labelWidth = items.reduce((m, it) => Math.max(m, it.label.length), 0);
  const valueWidth = items.reduce(
    (m, it) => Math.max(m, (it.value || "").length),
    0
  );

  return (
    <Box marginTop={1} flexDirection="column">
      <Box marginBottom={1}>
        <Text color={colors.accent}>{title}</Text>
      </Box>
      {items.map((it, index) => (
        <Box key={it.id} paddingLeft={1}>
          <Text
            color={index === selectedIndex ? colors.selectionFg : colors.text}
            backgroundColor={
              index === selectedIndex ? colors.selectionBg : undefined
            }
          >
            {it.label.padEnd(labelWidth, " ")}
            {valueWidth > 0 ? "  " : ""}
            {(it.value || "").padEnd(valueWidth, " ")}
            {it.hint ? `  ${it.hint}` : ""}
          </Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={colors.textDim} dimColor>
          ↑↓ navigate • Enter/Tab select • Esc back
        </Text>
      </Box>
    </Box>
  );
}

