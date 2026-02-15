# Color theming plan

## Goal

Improve readability by introducing color themes: semantic tokens (prompt, border, text, accent, etc.) and at least two themes—**default** (tuned for dark terminals) and **high-contrast** (better legibility). Optional: **light** theme and persistence via user settings.

## Current state

- **[src/ui/utils/colors.ts](src/ui/utils/colors.ts)** exports a `Colors` object (yellow, gray, red, green, blue, cyan, magenta, white, black) but it is not used consistently.
- Colors are **hardcoded** in many components: `chat-input.tsx` (blue/yellow/cyan, white/black cursor), `chat-history.tsx` (gray, white, cyan, magenta), `chat-interface.tsx`, `api-key-input.tsx`, `confirmation-dialog.tsx`, `model-selection.tsx`, `command-suggestions.tsx`, `diff-renderer.tsx`, `app.tsx`, `loading-spinner.tsx`, `mcp-status.tsx`.
- Problems: low contrast (e.g. cyan on dark), no single place to adjust palette, no user choice.

## 1. Theme shape and semantic tokens

Define a **theme** as an object of semantic tokens that components use instead of raw color names.

**New types (e.g. in [src/ui/utils/theme.ts](src/ui/utils/theme.ts)):**

```ts
export interface ThemeColors {
  // Input and prompts
  prompt: string;           // Prompt symbol (e.g. ❯)
  promptDim?: string;      // Secondary prompt (e.g. │)
  border: string;          // Input box border (idle)
  borderActive: string;    // Input box border (processing/streaming)
  placeholder: string;     // Placeholder text
  placeholderBg?: string;  // Optional, for cursor block
  cursorFg: string;
  cursorBg: string;
  // Chat
  text: string;            // Primary content
  textDim: string;         // Secondary (timestamps, hints)
  userPrefix: string;      // User message ">"
  assistantPrefix: string; // Assistant "⏺"
  toolPrefix: string;      // Tool call "⏺"
  accent: string;          // Highlights (model name, links)
  accentDim?: string;      // Softer accent
  // Status
  success: string;
  error: string;
  warning: string;
  info: string;
  // Selection / UI
  selectionFg: string;
  selectionBg: string;
}
export type ThemeId = 'default' | 'high-contrast' | 'light';
export interface Theme {
  id: ThemeId;
  name: string;
  colors: ThemeColors;
}
```

Use **Ink-supported color names** or hex where needed (`#ffffff`, etc.). Ink accepts `color="green"`, `color="#00ff00"`, and names like `gray`, `cyan`, `white`, `black`.

## 2. Define themes

**Default theme (dark-optimized):**  
Tuned for dark backgrounds: avoid pure white, use softer cyan/green so they’re readable. Example: prompt `cyan`, border `blue`, borderActive `yellow`, text `white`, textDim `gray`, accent `cyan`, success `green`, error `red`, warning `yellow`, cursor block `white` on `black` or inverse.

**High-contrast theme:**  
Maximize legibility: brighter text, stronger borders, clear distinction between prompt/content/status. Example: text `white`, textDim `white` (no dim or use bold), border `brightCyan` or `brightBlue`, accent `brightCyan`, success `green`, error `red`, cursor block high contrast.

**Light theme (optional):**  
For light terminal backgrounds: dark text, dark prompt, dark borders (e.g. `black`, `gray`, `blue`), light background where applicable (if Ink supports it).

Implement in [src/ui/utils/theme.ts](src/ui/utils/theme.ts):

- `THEMES: Record<ThemeId, Theme>` with `default`, `high-contrast`, and optionally `light`.
- `getTheme(themeId: ThemeId): Theme`.
- Export `ThemeId` and `Theme` for consumers.

## 3. Theme context and provider

- **Create [src/ui/context/theme-context.tsx](src/ui/context/theme-context.tsx)** (or under `src/ui/utils/`):
  - `ThemeContext` holding `{ theme: Theme; setThemeId: (id: ThemeId) => void }`.
  - `ThemeProvider` that:
    - Reads initial theme from settings (see below) or env `GROK_THEME` (e.g. `default`, `high-contrast`, `light`).
    - Stores current `ThemeId` in state and provides `theme` (resolved from `THEMES[id]`) and `setThemeId`.
  - `useTheme(): { theme: Theme; setThemeId: (id: ThemeId) => void }` hook.

- **Wire provider in the app root:** In [src/index.ts](src/index.ts) (or wherever the Ink root is rendered), wrap the tree with `ThemeProvider` so all UI components can use `useTheme()`.

## 4. Persist theme in user settings

- In [src/utils/settings-manager.ts](src/utils/settings-manager.ts):
  - Add `theme?: ThemeId` to `UserSettings`.
  - In `DEFAULT_USER_SETTINGS`, set `theme: 'default'` (or omit; code treats missing as `'default'`).
  - No migration required if `theme` is optional; existing files keep working.

- In `ThemeProvider`: on mount, call `getSettingsManager().loadUserSettings()` and use `settings.theme` if valid; otherwise fall back to `GROK_THEME` or `'default'`. When `setThemeId` is called, update state and call `saveUserSettings({ ...current, theme: id })` so the choice persists.

## 5. Refactor components to use theme

Replace hardcoded color strings with theme tokens. Use `const { theme } = useTheme()` (or pass `theme` as prop if you prefer to avoid context in a few places).

| File | Changes |
|------|--------|
| [src/ui/components/chat-input.tsx](src/ui/components/chat-input.tsx) | `borderColor` → `theme.colors.border` / `theme.colors.borderActive`; `promptColor` → `theme.colors.prompt`; placeholder/cursor → `theme.colors.placeholder`, `theme.colors.cursorFg`/`cursorBg`; "N images attached" → `theme.colors.warning` or `accent`. |
| [src/ui/components/chat-history.tsx](src/ui/components/chat-history.tsx) | User ">" → `theme.colors.userPrefix`; assistant "⏺" and content → `theme.colors.assistantPrefix`, `theme.colors.text`; tool call/result → `theme.colors.toolPrefix`, `theme.colors.textDim`, `theme.colors.accent`; streaming cursor → `theme.colors.accent`. |
| [src/ui/components/chat-interface.tsx](src/ui/components/chat-interface.tsx) | Headers and hints → `theme.colors.accent`, `theme.colors.textDim`; model badge → `theme.colors.warning` or `accent`. |
| [src/ui/components/api-key-input.tsx](src/ui/components/api-key-input.tsx) | Title → `theme.colors.accent`; hints → `theme.colors.textDim`; error → `theme.colors.error`; border → `theme.colors.border`. |
| [src/ui/components/confirmation-dialog.tsx](src/ui/components/confirmation-dialog.tsx) | Border → `theme.colors.borderActive`; labels → `theme.colors.text` / `textDim`; selection → `theme.colors.selectionFg`/`selectionBg`. |
| [src/ui/components/model-selection.tsx](src/ui/components/model-selection.tsx) | Title → `theme.colors.accent`; selected row → `theme.colors.selectionFg`/`selectionBg`; hint → `theme.colors.textDim`. |
| [src/ui/components/command-suggestions.tsx](src/ui/components/command-suggestions.tsx) | Same pattern as model-selection for selection and hints. |
| [src/ui/components/diff-renderer.tsx](src/ui/components/diff-renderer.tsx) | Keep diff-specific colors (green/red for add/remove) but optionally map "No diff" / dim to `theme.colors.textDim`, `theme.colors.accent`. |
| [src/ui/app.tsx](src/ui/app.tsx) | Success → `theme.colors.success`; Error → `theme.colors.error`; header → `theme.colors.accent`. |
| [src/ui/components/loading-spinner.tsx](src/ui/components/loading-spinner.tsx) | Use `theme.colors.accent` and `theme.colors.textDim`. |
| [src/ui/components/mcp-status.tsx](src/ui/components/mcp-status.tsx) | Use `theme.colors.success` or `theme.colors.textDim`. |

Use fallbacks (e.g. `theme.colors.prompt ?? 'cyan'`) only if a token is optional.

## 6. Theme switcher (optional)

- **Option A – `/theme` command:** In [src/hooks/use-input-handler.ts](src/hooks/use-input-handler.ts) (or command handler), when the user types `/theme` or `/theme high-contrast`, show a small menu (like model selection) to pick `default` | `high-contrast` | `light`, then call `setThemeId` and persist. Requires passing `setThemeId` into the input handler (e.g. from context or props).
- **Option B – Env / config only:** No in-app switcher; user sets `GROK_THEME=high-contrast` or `theme` in `~/.grok/user-settings.json` and restarts. Simpler; good for v1.

Recommendation: implement **Option B** first; add `/theme` in a follow-up if desired.

## 7. Documentation

- **README:** Add a short "Theming" or "Appearance" section: list themes (`default`, `high-contrast`, `light`), how to set `GROK_THEME` or `theme` in user settings, and that high-contrast is recommended for readability.
- **CONTRIBUTING / code:** In [src/ui/utils/theme.ts](src/ui/utils/theme.ts), document that new themes can be added to `THEMES` and that tokens should stay semantic so themes remain consistent.

## Implementation order

1. **Theme types and definitions** – Add [src/ui/utils/theme.ts](src/ui/utils/theme.ts) with `ThemeColors`, `Theme`, `ThemeId`, `THEMES`, `getTheme`. Implement `default` and `high-contrast`; optionally `light`.
2. **Theme context** – Add [src/ui/context/theme-context.tsx](src/ui/context/theme-context.tsx) with `ThemeProvider` and `useTheme`; read from env/settings, no persistence yet.
3. **Settings** – Add `theme?: ThemeId` to `UserSettings`, persist in `ThemeProvider` when theme is set (and optionally allow setting via CLI flag or later `/theme`).
4. **Wire provider** – Wrap Ink root in `ThemeProvider` in [src/index.ts](src/index.ts).
5. **Refactor components** – One by one, replace hardcoded colors with `useTheme().theme.colors.*` in the listed files. Start with `chat-input` and `chat-history` (biggest readability gain), then the rest.
6. **Docs** – Update README (and optionally CONTRIBUTING) as above.

## Files to add or touch (summary)

| Step | Files |
|------|--------|
| 1 | New [src/ui/utils/theme.ts](src/ui/utils/theme.ts) (types + THEMES + getTheme) |
| 2 | New [src/ui/context/theme-context.tsx](src/ui/context/theme-context.tsx) (ThemeProvider, useTheme) |
| 3 | [src/utils/settings-manager.ts](src/utils/settings-manager.ts) (UserSettings.theme, default) |
| 4 | [src/index.ts](src/index.ts) (wrap with ThemeProvider) |
| 5 | [src/ui/components/chat-input.tsx](src/ui/components/chat-input.tsx), [chat-history.tsx](src/ui/components/chat-history.tsx), [chat-interface.tsx](src/ui/components/chat-interface.tsx), [api-key-input.tsx](src/ui/components/api-key-input.tsx), [confirmation-dialog.tsx](src/ui/components/confirmation-dialog.tsx), [model-selection.tsx](src/ui/components/model-selection.tsx), [command-suggestions.tsx](src/ui/components/command-suggestions.tsx), [diff-renderer.tsx](src/ui/components/diff-renderer.tsx), [app.tsx](src/ui/app.tsx), [loading-spinner.tsx](src/ui/components/loading-spinner.tsx), [mcp-status.tsx](src/ui/components/mcp-status.tsx) |
| 6 | [README.md](README.md) (theming section) |

## Verification

- Run CLI with default theme: colors should match current look (or improved contrast).
- Set `GROK_THEME=high-contrast` (or `theme: "high-contrast"` in user-settings.json), restart: prompts, borders, and text should be easier to read.
- Optionally set `theme: "light"` and use in a light terminal: dark text and borders should be visible.

No new npm dependencies; Ink’s `Text`/`Box` already accept `color` and `backgroundColor`; we only centralize and switch the values by theme.
