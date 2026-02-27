# Grok CLI UI Issues: Screen Flashing & Copy/Paste Problems

**Analysis Date:** Current session (Feb 27, 2026). Based on codebase scan (rg/search/view_file).

## Root Cause: Ink Terminal UI Library
- **Ink v4.4.1** (package.json): React-based full-screen terminal renderer (`render()` from 'ink').
  - UI: src/ui/app.tsx (root), components/chat-interface.tsx, hooks/use-input-handler.ts/use-enhanced-input.ts.
  - Features: Box/Text layouts, useInput hooks, spinners, markdown (marked-terminal), chat history.

Ink **blits full screen** on every render cycle (state/useEffect changes):
```
src/index.ts: import { render } from "ink";
src/ui/app.tsx: <Box><Agent/><ConfirmationDialog/></Box>  // Re-renders on chat updates
```

## 1. Screen Flashing
**Why?**
- **Full clears/redraws**: Ink sends `\x1b[2J` (erase screen) + cursor reset + ANSI for entire viewport → Visible flicker.
- **Triggers**:
  - Chat appends (new messages → re-render history).
  - Loaders/spinners: `clearInterval()` in loading-spinner.tsx/mcp-status.tsx.
  - Input: useInput handlers (clearInput(), /clear cmds).
  - Confirmations: Dialogs overlay.
- **Windows Aggravator** (D:\zPython\grok-cli):
  - cmd/PowerShell: Slow ANSI parsing → Stutter/flash.
  - Frequent frames (60fps default) overwhelm terminal emulator.
- **No explicit `console.clear()`**, but Ink's mechanism equivalent.

**Evidence**:
```
rg clear src/ → 30+ hits: clearInput(), clearInterval(), clearAllChunks() → State resets → Re-renders.
chat-interface.tsx:253: clearInterval(interval);
use-input-handler.ts: "Ctrl+C to clear, 'exit' to quit"
```

**Fixes**:
- Memoize components (`React.memo`), use `useFocus` sparingly.
- Ink `<Static>` for non-interactive parts.
- Terminal: Windows Terminal (WT) > PowerShell 7 > cmd.
- Config: `ink --no-clear`? Or custom renderer.

## 2. Copy/Paste Issues
**Why?**
- **Key Capture**: Ink `useInput()` monopolizes stdin → Ctrl+C/V handled in-app:
  - Ctrl+C: Clears input/chat ("Ctrl+C to clear" in UI).
  - No forwarding to OS clipboard.
- **Paste Logic**: Custom, image-focused (utils/clipboard-image.ts):
  ```
  use-input-handler.ts:579: // Paste: skip clipboard image check when pasted content is clearly text (long string)
  ```
  - Win: PowerShell scripts for clipboard → Brittle (tmp files, fs ops).
  - Text paste works (detects long strings), but images prioritized → Conflicts.
- **Selection Copy**: Full-screen redraws erase terminal's selection highlight/buffer.

**Evidence**:
```
rg paste src/ → clipboard-image.ts (Win PS scripts), use-input-handler.ts (paste checks).
No std lib (e.g., clipboardy); custom hacks.
```

**Fixes**:
- Add Ink hooks: Detect Ctrl+C/V, use `clipboardy`/`pbcopy` externally.
- Toggle: `/ui-toggle` to pause Ink renders for copy.
- Docs: "Use mouse select outside UI or Win+Ctrl+C".

## Summary
- **Ink Tradeoff**: Rich React UI → Performance hit on complex chats/Windows.
- **Prevalence**: High-activity sessions (tools, todos → flashes).
- **Test**: Run `bun src/index.ts` → Observe in WT vs cmd.

**Recommendations**:
1. Upgrade Ink? Profile renders.
2. Add CLI flag: `--no-ui` (text-only).
3. PR: Memoize chat history, clipboard forwarding.

Reference: [Ink Docs](https://github.com/vadimdemedes/ink), Windows ANSI quirks.