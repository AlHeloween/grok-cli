import { useState, useCallback, useRef } from "react";
import {
  deleteCharBefore,
  deleteCharAfter,
  deleteWordBefore,
  deleteWordAfter,
  insertText,
  moveToLineStart,
  moveToLineEnd,
  moveToPreviousWord,
  moveToNextWord,
} from "../utils/text-utils.js";
import { useInputHistory } from "./use-input-history.js";

/** Maximum input buffer length; pastes/inserts beyond this are truncated. */
const MAX_INPUT_LENGTH = 100_000;

function capToMaxLength(
  text: string,
  position: number,
  onTruncated?: (trimmedCount: number) => void
): { text: string; position: number } {
  if (text.length <= MAX_INPUT_LENGTH) return { text, position };
  onTruncated?.(text.length - MAX_INPUT_LENGTH);
  return {
    text: text.slice(0, MAX_INPUT_LENGTH),
    position: Math.min(position, MAX_INPUT_LENGTH),
  };
}

export interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  paste?: boolean;
  sequence?: string;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

/** Return value of useEnhancedInput: state and handlers for a single-line or multiline text input with history. */
export interface EnhancedInputHook {
  input: string;
  cursorPosition: number;
  isMultiline: boolean;
  setInput: (text: string) => void;
  setCursorPosition: (position: number) => void;
  clearInput: () => void;
  insertAtCursor: (text: string) => void;
  resetHistory: () => void;
  handleInput: (inputChar: string, key: Key) => void;
}

interface UseEnhancedInputProps {
  onSubmit?: (text: string) => void;
  onEscape?: () => void;
  /** Return true to prevent default (e.g. swallow paste); false to let input be inserted. May return Promise<boolean> for async paste (e.g. clipboard image check). */
  onSpecialKey?: (key: Key, pasteText?: string) => boolean | Promise<boolean>;
  onTruncated?: (trimmedCount: number) => void;
  disabled?: boolean;
  multiline?: boolean;
}

/**
 * Hook for enhanced terminal input: history, cursor, paste handling, and optional special-key handler.
 * Input is capped at 100k characters; use onTruncated to show a message when truncation occurs.
 */
export function useEnhancedInput({
  onSubmit,
  onEscape,
  onSpecialKey,
  onTruncated,
  disabled = false,
  multiline = false,
}: UseEnhancedInputProps = {}): EnhancedInputHook {
  const [input, setInputState] = useState("");
  const [cursorPosition, setCursorPositionState] = useState(0);
  const isMultilineRef = useRef(multiline);
  const pendingPasteQueueRef = useRef<string[]>([]);
  const pasteDrainingRef = useRef(false);
  const insertAtCursorRef = useRef<(text: string) => void>(() => {});

  // Refs for stable setInput/setCursorPosition: avoid changing callback identity on every
  // keystroke/cursor move so parents (e.g. chat-interface) don't re-render and flash when
  // there is heavy output (e.g. search over many files).
  const inputRef = useRef(input);
  const cursorPositionRef = useRef(cursorPosition);
  inputRef.current = input;
  cursorPositionRef.current = cursorPosition;

  const {
    addToHistory,
    navigateHistory,
    resetHistory,
    setOriginalInput,
    isNavigatingHistory,
  } = useInputHistory();

  const setOriginalInputRef = useRef(setOriginalInput);
  const isNavigatingHistoryRef = useRef(isNavigatingHistory);
  setOriginalInputRef.current = setOriginalInput;
  isNavigatingHistoryRef.current = isNavigatingHistory;

  const applyState = useCallback(
    (nextText: string, nextPosition: number) => {
      const { text: capped, position } = capToMaxLength(
        nextText,
        nextPosition,
        onTruncated
      );
      inputRef.current = capped;
      cursorPositionRef.current = position;
      setInputState(capped);
      setCursorPositionState(position);
      setOriginalInputRef.current(capped);
    },
    [onTruncated]
  );

  const setInput = useCallback((text: string) => {
    const cur = cursorPositionRef.current;
    const nextPosition = Math.min(text.length, cur);
    inputRef.current = text;
    cursorPositionRef.current = nextPosition;
    setInputState(text);
    setCursorPositionState(nextPosition);
    setOriginalInputRef.current(text);
  }, []);

  const setCursorPosition = useCallback((position: number) => {
    const len = inputRef.current.length;
    const nextPosition = Math.max(0, Math.min(len, position));
    cursorPositionRef.current = nextPosition;
    setCursorPositionState(nextPosition);
  }, []);

  const clearInput = useCallback(() => {
    inputRef.current = "";
    cursorPositionRef.current = 0;
    setInputState("");
    setCursorPositionState(0);
    setOriginalInputRef.current("");
  }, []);

  const insertAtCursor = useCallback((text: string) => {
    const currentInput = inputRef.current;
    const currentPosition = cursorPositionRef.current;
    const result = insertText(currentInput, currentPosition, text);
    applyState(result.text, result.position);
  }, [applyState]);

  insertAtCursorRef.current = insertAtCursor;

  const drainPasteQueue = useCallback(() => {
    // Intentionally process at most one paste per tick. This gives React a chance to commit state updates
    // so the next drain uses the latest `insertAtCursorRef.current` (and avoids stale cursor/input state).
    if (pasteDrainingRef.current || pendingPasteQueueRef.current.length === 0) return;
    pasteDrainingRef.current = true;
    const text = pendingPasteQueueRef.current.shift()!;
    insertAtCursorRef.current(text);
    pasteDrainingRef.current = false;
    if (pendingPasteQueueRef.current.length > 0) {
      setTimeout(drainPasteQueue, 0);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const currentInput = inputRef.current;
    if (currentInput.trim()) {
      addToHistory(currentInput);
      onSubmit?.(currentInput);
      clearInput();
    }
  }, [addToHistory, onSubmit, clearInput]);

  const handleInput = useCallback((inputChar: string, key: Key) => {
    if (disabled) return;

    const currentInput = inputRef.current;
    const currentCursorPosition = cursorPositionRef.current;

    // Handle Ctrl+C - check multiple ways it could be detected
    if ((key.ctrl && inputChar === "c") || inputChar === "\x03") {
      applyState("", 0);
      return;
    }

    // Allow special key handler to override default behavior (e.g. paste → clipboard image when key.paste is true)
    const specialResult = onSpecialKey?.(key, key.paste ? inputChar : undefined);
    if (specialResult !== undefined && specialResult !== null) {
      const isPromise =
        typeof (specialResult as Promise<boolean>).then === "function";
      if (isPromise) {
        (specialResult as Promise<boolean>).then((handled) => {
          if (!handled && key.paste && inputChar) {
            pendingPasteQueueRef.current.push(inputChar);
            drainPasteQueue();
          }
        });
        return;
      }
      if (specialResult) return;
    }

    // Handle Escape
    if (key.escape) {
      onEscape?.();
      return;
    }

    // Handle Enter/Return
    const isEnter =
      !!key.return ||
      key.name === "return" ||
      inputChar === "\r" ||
      inputChar === "\n";
    if (isEnter) {
      if (multiline && key.shift) {
        // Shift+Enter in multiline mode inserts newline
        const result = insertText(currentInput, currentCursorPosition, "\n");
        applyState(result.text, result.position);
      } else {
        handleSubmit();
      }
      return;
    }

    // Handle history navigation
    if ((key.upArrow || key.name === 'up') && !key.ctrl && !key.meta) {
      const historyInput = navigateHistory("up");
      if (historyInput !== null) {
        applyState(historyInput, historyInput.length);
      }
      return;
    }

    if ((key.downArrow || key.name === 'down') && !key.ctrl && !key.meta) {
      const historyInput = navigateHistory("down");
      if (historyInput !== null) {
        applyState(historyInput, historyInput.length);
      }
      return;
    }

    // Handle cursor movement - ignore meta flag for arrows as it's unreliable in terminals
    // Only do word movement if ctrl is pressed AND no arrow escape sequence is in inputChar
    if ((key.leftArrow || key.name === 'left') && key.ctrl && !inputChar.includes('[')) {
      const newPos = moveToPreviousWord(currentInput, currentCursorPosition);
      applyState(currentInput, newPos);
      return;
    }

    if ((key.rightArrow || key.name === 'right') && key.ctrl && !inputChar.includes('[')) {
      const newPos = moveToNextWord(currentInput, currentCursorPosition);
      applyState(currentInput, newPos);
      return;
    }

    // Handle regular cursor movement - single character (ignore meta flag)
    if (key.leftArrow || key.name === 'left') {
      const newPos = Math.max(0, currentCursorPosition - 1);
      applyState(currentInput, newPos);
      return;
    }

    if (key.rightArrow || key.name === 'right') {
      const newPos = Math.min(currentInput.length, currentCursorPosition + 1);
      applyState(currentInput, newPos);
      return;
    }

    // Handle Home/End keys or Ctrl+A/E
    if ((key.ctrl && inputChar === "a") || key.name === "home") {
      applyState(currentInput, 0); // Simple start of input
      return;
    }

    if ((key.ctrl && inputChar === "e") || key.name === "end") {
      applyState(currentInput, currentInput.length); // Simple end of input
      return;
    }

    // Handle deletion - check multiple ways backspace might be detected
    // Backspace can be detected in different ways depending on terminal
    // In some terminals, backspace shows up as delete:true with empty inputChar
    const isBackspace = key.backspace || 
                       key.name === 'backspace' || 
                       inputChar === '\b' || 
                       inputChar === '\x7f' ||
                       (key.delete && inputChar === '' && !key.shift);
                       
    if (isBackspace) {
      if (key.ctrl || key.meta) {
        // Ctrl/Cmd + Backspace: Delete word before cursor
        const result = deleteWordBefore(currentInput, currentCursorPosition);
        applyState(result.text, result.position);
      } else {
        // Regular backspace
        const result = deleteCharBefore(currentInput, currentCursorPosition);
        applyState(result.text, result.position);
      }
      return;
    }

    // Handle forward delete (Del key) - but not if it was already handled as backspace above
    if ((key.delete && inputChar !== '') || (key.ctrl && inputChar === "d")) {
      if (key.ctrl || key.meta) {
        // Ctrl/Cmd + Delete: Delete word after cursor
        const result = deleteWordAfter(currentInput, currentCursorPosition);
        applyState(result.text, result.position);
      } else {
        // Regular delete
        const result = deleteCharAfter(currentInput, currentCursorPosition);
        applyState(result.text, result.position);
      }
      return;
    }

    // Handle Ctrl+K: Delete from cursor to end of line
    if (key.ctrl && inputChar === "k") {
      const lineEnd = moveToLineEnd(currentInput, currentCursorPosition);
      const newText =
        currentInput.slice(0, currentCursorPosition) + currentInput.slice(lineEnd);
      applyState(newText, currentCursorPosition);
      return;
    }

    // Handle Ctrl+U: Delete from cursor to start of line
    if (key.ctrl && inputChar === "u") {
      const lineStart = moveToLineStart(currentInput, currentCursorPosition);
      const newText =
        currentInput.slice(0, lineStart) + currentInput.slice(currentCursorPosition);
      applyState(newText, lineStart);
      return;
    }

    // Handle Ctrl+W: Delete word before cursor
    if (key.ctrl && inputChar === "w") {
      const result = deleteWordBefore(currentInput, currentCursorPosition);
      applyState(result.text, result.position);
      return;
    }

    // Handle Ctrl+X: Clear entire input
    if (key.ctrl && inputChar === "x") {
      applyState("", 0);
      return;
    }

    // Handle regular character input
    // Ink normally passes printable keys via `inputChar`, but in some terminals
    // (notably on Windows) `inputChar` may be empty while `key.sequence` (or even
    // `key.name`) contains the typed character.
    const seq = typeof key.sequence === "string" ? key.sequence : "";
    const name = typeof key.name === "string" ? key.name : "";

    const isSingleChar = (s: string) => !!s && Array.from(s).length === 1;
    const isPrintableChar = (s: string) =>
      isSingleChar(s) &&
      s !== "\n" &&
      s !== "\r" &&
      s !== "\t" &&
      s !== "\u001b" &&
      s !== "\b" &&
      s !== "\x7f";

    const inputIsPrintable = isPrintableChar(inputChar);
    const seqIsPrintable = isPrintableChar(seq);
    const nameIsPrintable = isPrintableChar(name);

    const charToInsert = inputIsPrintable
      ? inputChar
      : seqIsPrintable
        ? seq
        : nameIsPrintable
          ? name
          : "";

    // Do not block insert on ctrl/meta here; shortcuts are handled above and some terminals misreport modifiers.
    if (charToInsert) {
      const result = insertText(currentInput, currentCursorPosition, charToInsert);
      applyState(result.text, result.position);
    }
  }, [disabled, onSpecialKey, multiline, applyState, handleSubmit, navigateHistory, onEscape]);

  return {
    input,
    cursorPosition,
    isMultiline: isMultilineRef.current,
    setInput,
    setCursorPosition,
    clearInput,
    insertAtCursor,
    resetHistory,
    handleInput,
  };
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/hooks/use-enhanced-input.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/hooks/use-enhanced-input.ts.backup_20260217T025024_217910"
//   "created_at": "2026-02-16T18:50:24.228611+00:00"
//   "backup_hash": "7e766c53a93c86f3fdf7d1d1102add21"
//   "new_hash": "5d936f5480572d5ab44335d6a5b3cd1e"
//   "goal_id": "enhanced_input_do_not_block_on_meta"
//   "semantics": ""
//   "update_attrs": {"relative_path": "src/hooks/use-enhanced-input.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "if (charToInsert && !key.ctrl && (!key.meta || seqIsPrintable)) {", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/hooks/use-enhanced-input.ts\""
// }
