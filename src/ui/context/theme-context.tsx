import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { getSettingsManager } from "../../utils/settings-manager.js";
import { DEFAULT_THEME_ID, getTheme, isThemeId, Theme, ThemeId } from "../utils/theme.js";

interface ThemeContextValue {
  themeId: ThemeId;
  theme: Theme;
  setThemeId: (next: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveInitialThemeId(): ThemeId {
  const envTheme = process.env.GROK_THEME?.trim();
  if (envTheme && isThemeId(envTheme)) {
    return envTheme;
  }

  try {
    const settingsTheme = getSettingsManager().getUserSetting("theme");
    if (typeof settingsTheme === "string" && isThemeId(settingsTheme)) {
      return settingsTheme;
    }
  } catch {
    // Ignore settings errors and fall back to default.
  }

  return DEFAULT_THEME_ID;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(resolveInitialThemeId);

  const setThemeId = useCallback((next: ThemeId) => {
    setThemeIdState(next);
    try {
      getSettingsManager().updateUserSetting("theme", next);
    } catch {
      // Ignore persistence failures; in-memory theme still updates.
    }
  }, []);

  const value = useMemo(
    () => ({
      themeId,
      theme: getTheme(themeId),
      setThemeId,
    }),
    [themeId, setThemeId]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    return {
      themeId: DEFAULT_THEME_ID,
      theme: getTheme(DEFAULT_THEME_ID),
      setThemeId: () => undefined,
    };
  }
  return value;
}
