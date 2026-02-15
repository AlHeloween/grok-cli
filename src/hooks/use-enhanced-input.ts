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

  const setInput = useCallback((text: string) => {
    const cur = cursorPositionRef.current;
    setInputState(text);
    setCursorPositionState(Math.min(text.length, cur));
    if (!isNavigatingHistoryRef.current()) {
      setOriginalInputRef.current(text);
    }
  }, []);

  const setCursorPosition = useCallback((position: number) => {
    const len = inputRef.current.length;
    setCursorPositionState(Math.max(0, Math.min(len, position)));
  }, []);

  const clearInput = useCallback(() => {
    setInputState("");
    setCursorPositionState(0);
    setOriginalInput("");
  }, [setOriginalInput]);

  const insertAtCursor = useCallback((text: string) => {
    const result = insertText(input, cursorPosition, text);
    const { text: capped, position } = capToMaxLength(result.text, result.position, onTruncated);
    setInputState(capped);
    setCursorPositionState(position);
    setOriginalInput(capped);
  }, [input, cursorPosition, setOriginalInput, onTruncated]);

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
    if (input.trim()) {
      addToHistory(input);
      onSubmit?.(input);
      clearInput();
    }
  }, [input, addToHistory, onSubmit, clearInput]);

  const handleInput = useCallback((inputChar: string, key: Key) => {
    if (disabled) return;

    // Handle Ctrl+C - check multiple ways it could be detected
    if ((key.ctrl && inputChar === "c") || inputChar === "\x03") {
      setInputState("");
      setCursorPositionState(0);
      setOriginalInput("");
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
    if (key.return) {
      if (multiline && key.shift) {
        // Shift+Enter in multiline mode inserts newline
        const result = insertText(input, cursorPosition, "\n");
        const { text: capped, position } = capToMaxLength(result.text, result.position, onTruncated);
        setInputState(capped);
        setCursorPositionState(position);
        setOriginalInput(capped);
      } else {
        handleSubmit();
      }
      return;
    }

    // Handle history navigation
    if ((key.upArrow || key.name === 'up') && !key.ctrl && !key.meta) {
      const historyInput = navigateHistory("up");
      if (historyInput !== null) {
        setInputState(historyInput);
        setCursorPositionState(historyInput.length);
      }
      return;
    }

    if ((key.downArrow || key.name === 'down') && !key.ctrl && !key.meta) {
      const historyInput = navigateHistory("down");
      if (historyInput !== null) {
        setInputState(historyInput);
        setCursorPositionState(historyInput.length);
      }
      return;
    }

    // Handle cursor movement - ignore meta flag for arrows as it's unreliable in terminals
    // Only do word movement if ctrl is pressed AND no arrow escape sequence is in inputChar
    if ((key.leftArrow || key.name === 'left') && key.ctrl && !inputChar.includes('[')) {
      const newPos = moveToPreviousWord(input, cursorPosition);
      setCursorPositionState(newPos);
      return;
    }

    if ((key.rightArrow || key.name === 'right') && key.ctrl && !inputChar.includes('[')) {
      const newPos = moveToNextWord(input, cursorPosition);
      setCursorPositionState(newPos);
      return;
    }

    // Handle regular cursor movement - single character (ignore meta flag)
    if (key.leftArrow || key.name === 'left') {
      const newPos = Math.max(0, cursorPosition - 1);
      setCursorPositionState(newPos);
      return;
    }

    if (key.rightArrow || key.name === 'right') {
      const newPos = Math.min(input.length, cursorPosition + 1);
      setCursorPositionState(newPos);
      return;
    }

    // Handle Home/End keys or Ctrl+A/E
    if ((key.ctrl && inputChar === "a") || key.name === "home") {
      setCursorPositionState(0); // Simple start of input
      return;
    }

    if ((key.ctrl && inputChar === "e") || key.name === "end") {
      setCursorPositionState(input.length); // Simple end of input
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
        const result = deleteWordBefore(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      } else {
        // Regular backspace
        const result = deleteCharBefore(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      }
      return;
    }

    // Handle forward delete (Del key) - but not if it was already handled as backspace above
    if ((key.delete && inputChar !== '') || (key.ctrl && inputChar === "d")) {
      if (key.ctrl || key.meta) {
        // Ctrl/Cmd + Delete: Delete word after cursor
        const result = deleteWordAfter(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      } else {
        // Regular delete
        const result = deleteCharAfter(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      }
      return;
    }

    // Handle Ctrl+K: Delete from cursor to end of line
    if (key.ctrl && inputChar === "k") {
      const lineEnd = moveToLineEnd(input, cursorPosition);
      const newText = input.slice(0, cursorPosition) + input.slice(lineEnd);
      setInputState(newText);
      setOriginalInput(newText);
      return;
    }

    // Handle Ctrl+U: Delete from cursor to start of line
    if (key.ctrl && inputChar === "u") {
      const lineStart = moveToLineStart(input, cursorPosition);
      const newText = input.slice(0, lineStart) + input.slice(cursorPosition);
      setInputState(newText);
      setCursorPositionState(lineStart);
      setOriginalInput(newText);
      return;
    }

    // Handle Ctrl+W: Delete word before cursor
    if (key.ctrl && inputChar === "w") {
      const result = deleteWordBefore(input, cursorPosition);
      setInputState(result.text);
      setCursorPositionState(result.position);
      setOriginalInput(result.text);
      return;
    }

    // Handle Ctrl+X: Clear entire input
    if (key.ctrl && inputChar === "x") {
      setInputState("");
      setCursorPositionState(0);
      setOriginalInput("");
      return;
    }

    // Handle regular character input
    if (inputChar && !key.ctrl && !key.meta) {
      const result = insertText(input, cursorPosition, inputChar);
      const { text: capped, position } = capToMaxLength(result.text, result.position, onTruncated);
      setInputState(capped);
      setCursorPositionState(position);
      setOriginalInput(capped);
    }
  }, [disabled, onSpecialKey, onTruncated, input, cursorPosition, multiline, handleSubmit, navigateHistory, setOriginalInput]);

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