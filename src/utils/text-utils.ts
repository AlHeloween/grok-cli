/**
 * Text manipulation utilities for terminal input handling
 * Inspired by Gemini CLI's text processing capabilities
 */

export interface TextPosition {
  index: number;
  line: number;
  column: number;
}

export interface TextSelection {
  start: number;
  end: number;
}

/**
 * Check if a character is a word boundary
 */
export function isWordBoundary(char: string | undefined): boolean {
  if (!char) return true;
  return /\s/.test(char) || /[^\w]/.test(char);
}

/**
 * Find the start of the current word at the given position
 */
export function findWordStart(text: string, position: number): number {
  if (position <= 0) return 0;
  
  let pos = position - 1;
  while (pos > 0 && !isWordBoundary(text[pos])) {
    pos--;
  }
  
  // If we stopped at a word boundary, move forward to the actual word start
  if (pos > 0 && isWordBoundary(text[pos])) {
    pos++;
  }
  
  return pos;
}

/**
 * Find the end of the current word at the given position
 */
export function findWordEnd(text: string, position: number): number {
  if (position >= text.length) return text.length;
  
  let pos = position;
  while (pos < text.length && !isWordBoundary(text[pos])) {
    pos++;
  }
  
  return pos;
}

/**
 * Move cursor to the previous word boundary
 */
export function moveToPreviousWord(text: string, position: number): number {
  if (position <= 0) return 0;
  
  let pos = position - 1;
  
  // Skip whitespace
  while (pos > 0 && isWordBoundary(text[pos])) {
    pos--;
  }
  
  // Find start of the word
  while (pos > 0 && !isWordBoundary(text[pos - 1])) {
    pos--;
  }
  
  return pos;
}

/**
 * Move cursor to the next word boundary
 */
export function moveToNextWord(text: string, position: number): number {
  if (position >= text.length) return text.length;
  
  let pos = position;
  
  // Skip current word
  while (pos < text.length && !isWordBoundary(text[pos])) {
    pos++;
  }
  
  // Skip whitespace
  while (pos < text.length && isWordBoundary(text[pos])) {
    pos++;
  }
  
  return pos;
}

/**
 * Delete the word before the cursor
 */
export function deleteWordBefore(text: string, position: number): { text: string; position: number } {
  const wordStart = moveToPreviousWord(text, position);
  const newText = text.slice(0, wordStart) + text.slice(position);
  
  return {
    text: newText,
    position: wordStart,
  };
}

/**
 * Delete the word after the cursor
 */
export function deleteWordAfter(text: string, position: number): { text: string; position: number } {
  const wordEnd = moveToNextWord(text, position);
  const newText = text.slice(0, position) + text.slice(wordEnd);
  
  return {
    text: newText,
    position,
  };
}

/**
 * Get the current line and column from text position
 */
export function getTextPosition(text: string, index: number): TextPosition {
  let line = 0;
  let lastNewlineIndex = -1;
  let pos = 0;

  // Count lines by finding newlines up to the index
  while (true) {
    const nextNewline = text.indexOf('\n', pos);
    if (nextNewline === -1 || nextNewline >= index) {
      break;
    }
    line++;
    lastNewlineIndex = nextNewline;
    pos = nextNewline + 1;
  }

  return {
    index,
    line,
    column: index - (lastNewlineIndex + 1),
  };
}

/**
 * Move to the beginning of the current line
 */
export function moveToLineStart(text: string, position: number): number {
  // Use lastIndexOf with start position to avoid slicing large strings
  const lastNewlineIndex = text.lastIndexOf('\n', position - 1);
  return lastNewlineIndex === -1 ? 0 : lastNewlineIndex + 1;
}

/**
 * Move to the end of the current line
 */
export function moveToLineEnd(text: string, position: number): number {
  // Use indexOf with start position to avoid slicing large strings
  const nextNewlineIndex = text.indexOf('\n', position);
  return nextNewlineIndex === -1 ? text.length : nextNewlineIndex;
}

/**
 * Handle proper Unicode-aware character deletion
 */
export function deleteCharBefore(text: string, position: number): { text: string; position: number } {
  if (position <= 0) {
    return { text, position };
  }
  
  // Handle surrogate pairs and combining characters
  let deleteCount = 1;
  const charBefore = text.charAt(position - 1);
  
  // Check for high surrogate (first part of surrogate pair)
  if (position >= 2) {
    const charBeforeBefore = text.charAt(position - 2);
    if (charBeforeBefore >= '\uD800' && charBeforeBefore <= '\uDBFF' && 
        charBefore >= '\uDC00' && charBefore <= '\uDFFF') {
      deleteCount = 2;
    }
  }
  
  const newText = text.slice(0, position - deleteCount) + text.slice(position);
  return {
    text: newText,
    position: position - deleteCount,
  };
}

/**
 * Handle proper Unicode-aware character deletion forward
 */
export function deleteCharAfter(text: string, position: number): { text: string; position: number } {
  if (position >= text.length) {
    return { text, position };
  }
  
  // Handle surrogate pairs and combining characters
  let deleteCount = 1;
  const charAfter = text.charAt(position);
  
  // Check for high surrogate (first part of surrogate pair)
  if (position + 1 < text.length) {
    const charAfterAfter = text.charAt(position + 1);
    if (charAfter >= '\uD800' && charAfter <= '\uDBFF' && 
        charAfterAfter >= '\uDC00' && charAfterAfter <= '\uDFFF') {
      deleteCount = 2;
    }
  }
  
  const newText = text.slice(0, position) + text.slice(position + deleteCount);
  return {
    text: newText,
    position,
  };
}

/**
 * Insert text at the given position with proper Unicode handling
 */
export function insertText(text: string, position: number, insert: string): { text: string; position: number } {
  const newText = text.slice(0, position) + insert + text.slice(position);
  return {
    text: newText,
    position: position + insert.length,
  };
}