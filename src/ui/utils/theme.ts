export type ThemeId =
  | "vscode-dark-plus"
  | "vscode-light-plus"
  | "vscode-high-contrast"
  | "vscode-high-contrast-light"
  | "vscode-github-dark"
  | "vscode-github-light"
  | "vscode-monokai"
  | "vscode-quiet-light";

export interface ThemeColors {
  text: string;
  textDim: string;
  accent: string;
  border: string;
  borderActive: string;
  prompt: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  userPrefix: string;
  assistantPrefix: string;
  toolPrefix: string;
  selectionFg: string;
  selectionBg: string;
  cursorFg: string;
  cursorBg: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  source: "vscode";
  colors: ThemeColors;
}

export const DEFAULT_THEME_ID: ThemeId = "vscode-dark-plus";

export const THEMES: Record<ThemeId, Theme> = {
  "vscode-dark-plus": {
    id: "vscode-dark-plus",
    name: "VS Code Dark+",
    source: "vscode",
    colors: {
      text: "white",
      textDim: "gray",
      accent: "cyan",
      border: "blue",
      borderActive: "yellow",
      prompt: "cyan",
      success: "green",
      error: "red",
      warning: "yellow",
      info: "blue",
      userPrefix: "gray",
      assistantPrefix: "white",
      toolPrefix: "magenta",
      selectionFg: "black",
      selectionBg: "cyan",
      cursorFg: "black",
      cursorBg: "white",
    },
  },
  "vscode-light-plus": {
    id: "vscode-light-plus",
    name: "VS Code Light+",
    source: "vscode",
    colors: {
      // Terminals typically keep a dark background; avoid pure black foreground which becomes unreadable.
      text: "white",
      textDim: "gray",
      accent: "blue",
      border: "blue",
      borderActive: "magenta",
      prompt: "blue",
      success: "green",
      error: "red",
      warning: "yellow",
      info: "blue",
      userPrefix: "gray",
      assistantPrefix: "white",
      toolPrefix: "magenta",
      selectionFg: "white",
      selectionBg: "blue",
      cursorFg: "white",
      cursorBg: "white",
    },
  },
  "vscode-high-contrast": {
    id: "vscode-high-contrast",
    name: "VS Code High Contrast",
    source: "vscode",
    colors: {
      text: "white",
      textDim: "white",
      accent: "yellow",
      border: "yellow",
      borderActive: "magenta",
      prompt: "yellow",
      success: "green",
      error: "red",
      warning: "yellow",
      info: "cyan",
      userPrefix: "white",
      assistantPrefix: "white",
      toolPrefix: "magenta",
      selectionFg: "black",
      selectionBg: "yellow",
      cursorFg: "black",
      cursorBg: "white",
    },
  },
  "vscode-high-contrast-light": {
    id: "vscode-high-contrast-light",
    name: "VS Code High Contrast Light",
    source: "vscode",
    colors: {
      // Same terminal-compatibility adjustment as other light themes.
      text: "white",
      textDim: "gray",
      accent: "blue",
      border: "white",
      borderActive: "blue",
      prompt: "blue",
      success: "green",
      error: "red",
      warning: "magenta",
      info: "blue",
      userPrefix: "white",
      assistantPrefix: "white",
      toolPrefix: "magenta",
      selectionFg: "white",
      selectionBg: "blue",
      cursorFg: "white",
      cursorBg: "white",
    },
  },
  "vscode-github-dark": {
    id: "vscode-github-dark",
    name: "VS Code GitHub Dark",
    source: "vscode",
    colors: {
      text: "white",
      textDim: "gray",
      accent: "blue",
      border: "blue",
      borderActive: "cyan",
      prompt: "blue",
      success: "green",
      error: "red",
      warning: "yellow",
      info: "blue",
      userPrefix: "gray",
      assistantPrefix: "white",
      toolPrefix: "magenta",
      selectionFg: "white",
      selectionBg: "blue",
      cursorFg: "black",
      cursorBg: "white",
    },
  },
  "vscode-github-light": {
    id: "vscode-github-light",
    name: "VS Code GitHub Light",
    source: "vscode",
    colors: {
      text: "white",
      textDim: "gray",
      accent: "blue",
      border: "gray",
      borderActive: "blue",
      prompt: "blue",
      success: "green",
      error: "red",
      warning: "magenta",
      info: "blue",
      userPrefix: "gray",
      assistantPrefix: "white",
      toolPrefix: "magenta",
      selectionFg: "white",
      selectionBg: "blue",
      cursorFg: "white",
      cursorBg: "white",
    },
  },
  "vscode-monokai": {
    id: "vscode-monokai",
    name: "VS Code Monokai",
    source: "vscode",
    colors: {
      text: "white",
      textDim: "gray",
      accent: "magenta",
      border: "magenta",
      borderActive: "yellow",
      prompt: "magenta",
      success: "green",
      error: "red",
      warning: "yellow",
      info: "cyan",
      userPrefix: "gray",
      assistantPrefix: "white",
      toolPrefix: "cyan",
      selectionFg: "black",
      selectionBg: "magenta",
      cursorFg: "black",
      cursorBg: "white",
    },
  },
  "vscode-quiet-light": {
    id: "vscode-quiet-light",
    name: "VS Code Quiet Light",
    source: "vscode",
    colors: {
      text: "white",
      textDim: "gray",
      accent: "cyan",
      border: "gray",
      borderActive: "cyan",
      prompt: "cyan",
      success: "green",
      error: "red",
      warning: "magenta",
      info: "blue",
      userPrefix: "gray",
      assistantPrefix: "white",
      toolPrefix: "magenta",
      selectionFg: "black",
      selectionBg: "cyan",
      cursorFg: "white",
      cursorBg: "white",
    },
  },
};

export function isThemeId(value: string): value is ThemeId {
  return Object.prototype.hasOwnProperty.call(THEMES, value);
}

export function getTheme(themeId: string | undefined): Theme {
  if (themeId && isThemeId(themeId)) {
    return THEMES[themeId];
  }
  return THEMES[DEFAULT_THEME_ID];
}

export function listThemes(): Theme[] {
  return Object.values(THEMES);
}
