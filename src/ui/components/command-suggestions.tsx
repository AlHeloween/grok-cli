import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/theme-context.js";

interface CommandSuggestion {
  command: string;
  description: string;
}

interface CommandSuggestionsProps {
  suggestions: CommandSuggestion[];
  input: string;
  selectedIndex: number;
  isVisible: boolean;
}

export const MAX_SUGGESTIONS = 20;

export function filterCommandSuggestions<T extends { command: string }>(
  suggestions: T[],
  input: string
): T[] {
  const lowerInput = input.toLowerCase();
  return suggestions
    .filter((s) => s.command.toLowerCase().startsWith(lowerInput))
    .slice(0, MAX_SUGGESTIONS);
}

export function CommandSuggestions({
  suggestions,
  input,
  selectedIndex,
  isVisible,
}: CommandSuggestionsProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  if (!isVisible) return null;

  const filteredSuggestions = useMemo(
    () => filterCommandSuggestions(suggestions, input),
    [suggestions, input]
  );

  return (
    <Box marginTop={1} flexDirection="column">
      {filteredSuggestions.map((suggestion, index) => (
        <Box key={index} paddingLeft={1}>
          <Text
            color={index === selectedIndex ? colors.selectionFg : colors.text}
            backgroundColor={index === selectedIndex ? colors.selectionBg : undefined}
          >
            {suggestion.command}
          </Text>
          <Box marginLeft={1}>
            <Text color={colors.textDim}>{suggestion.description}</Text>
          </Box>
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

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/ui/components/command-suggestions.tsx"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/ui/components/command-suggestions.tsx.backup_20260303T165002_784150"
//   "created_at": "2026-03-03T08:50:02.794996+00:00"
//   "backup_hash": "5e422ef8d22aa0265a30ee633b7df460"
//   "new_hash": "ecac2a3697ba4a3c843a26eed4a50d07"
//   "goal_id": "text_anchor_replace"
//   "semantics": "Increase max suggestions to show all CLI options when navigating"
//   "update_attrs": {"relative_path": "src/ui/components/command-suggestions.tsx", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "export const MAX_SUGGESTIONS = 8;", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/ui/components/command-suggestions.tsx\""
// }
