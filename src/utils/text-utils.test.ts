import { describe, it, expect } from "vitest";
import {
  insertText,
  deleteCharBefore,
  deleteCharAfter,
  deleteWordBefore,
  deleteWordAfter,
  moveToLineStart,
  moveToLineEnd,
  moveToPreviousWord,
  moveToNextWord,
  findWordStart,
  findWordEnd,
  isWordBoundary,
  getTextPosition,
} from "./text-utils.js";

describe("getTextPosition", () => {
  it("returns correct line and column for various positions", () => {
    const text = "line1\nline2\nline3";
    expect(getTextPosition(text, 0)).toEqual({ index: 0, line: 0, column: 0 });
    expect(getTextPosition(text, 5)).toEqual({ index: 5, line: 0, column: 5 });
    expect(getTextPosition(text, 6)).toEqual({ index: 6, line: 1, column: 0 });
    expect(getTextPosition(text, 11)).toEqual({ index: 11, line: 1, column: 5 });
    expect(getTextPosition(text, 12)).toEqual({ index: 12, line: 2, column: 0 });
    expect(getTextPosition(text, 17)).toEqual({ index: 17, line: 2, column: 5 });
  });

  it("handles empty string", () => {
    expect(getTextPosition("", 0)).toEqual({ index: 0, line: 0, column: 0 });
  });

  it("handles multiple newlines", () => {
    const text = "\n\n";
    expect(getTextPosition(text, 0)).toEqual({ index: 0, line: 0, column: 0 });
    expect(getTextPosition(text, 1)).toEqual({ index: 1, line: 1, column: 0 });
    expect(getTextPosition(text, 2)).toEqual({ index: 2, line: 2, column: 0 });
  });

  it("handles out of bounds indices", () => {
    const text = "abc";
    expect(getTextPosition(text, -1)).toEqual({ index: 0, line: 0, column: 0 });
    expect(getTextPosition(text, 10)).toEqual({ index: 3, line: 0, column: 3 });
  });
});

describe("insertText", () => {
  it("inserts at position and returns new position", () => {
    const result = insertText("hello", 2, "XX");
    expect(result.text).toBe("heXXllo");
    expect(result.position).toBe(4);
  });

  it("inserts at start", () => {
    const result = insertText("world", 0, ">>");
    expect(result.text).toBe(">>world");
    expect(result.position).toBe(2);
  });

  it("inserts at end", () => {
    const result = insertText("hi", 2, "!");
    expect(result.text).toBe("hi!");
    expect(result.position).toBe(3);
  });
});

describe("deleteCharBefore", () => {
  it("deletes one character and moves cursor back", () => {
    const result = deleteCharBefore("hello", 3);
    expect(result.text).toBe("helo");
    expect(result.position).toBe(2);
  });

  it("does nothing at position 0", () => {
    const result = deleteCharBefore("hello", 0);
    expect(result.text).toBe("hello");
    expect(result.position).toBe(0);
  });
});

describe("deleteCharAfter", () => {
  it("deletes one character after cursor", () => {
    const result = deleteCharAfter("hello", 2);
    expect(result.text).toBe("helo");
    expect(result.position).toBe(2);
  });

  it("does nothing at end", () => {
    const result = deleteCharAfter("hi", 2);
    expect(result.text).toBe("hi");
    expect(result.position).toBe(2);
  });
});

describe("deleteWordBefore", () => {
  it("deletes word before cursor", () => {
    const result = deleteWordBefore("hello world", 5);
    expect(result.text).toBe(" world");
    expect(result.position).toBe(0);
  });
});

describe("deleteWordAfter", () => {
  it("deletes word after cursor", () => {
    const result = deleteWordAfter("hello world", 0);
    expect(result.text).toBe("world");
    expect(result.position).toBe(0);
  });
});

describe("moveToLineStart", () => {
  it("returns start of current line", () => {
    expect(moveToLineStart("a\nbc\nd", 4)).toBe(2);
    expect(moveToLineStart("abc", 2)).toBe(0);
  });

  it("handles start of file with newline correctly", () => {
    expect(moveToLineStart("\nabc", 0)).toBe(0);
  });
});

describe("moveToLineEnd", () => {
  it("returns end of current line", () => {
    expect(moveToLineEnd("a\nbc\nd", 2)).toBe(4);
    expect(moveToLineEnd("abc", 1)).toBe(3);
  });
});

describe("moveToPreviousWord", () => {
  it("moves to start of current word when inside a word", () => {
    expect(moveToPreviousWord("one two three", 10)).toBe(8);
  });
  it("moves to start of previous word from space", () => {
    expect(moveToPreviousWord("one two three", 7)).toBe(4);
  });
});

describe("moveToNextWord", () => {
  it("moves to start of next word", () => {
    expect(moveToNextWord("one two three", 0)).toBe(4);
  });
});

describe("findWordStart", () => {
  it("finds start of word at position", () => {
    expect(findWordStart("hello world", 7)).toBe(6);
  });
});

describe("findWordEnd", () => {
  it("finds end of word at position", () => {
    expect(findWordEnd("hello world", 2)).toBe(5);
  });
});

describe("isWordBoundary", () => {
  it("returns true for space and punctuation", () => {
    expect(isWordBoundary(" ")).toBe(true);
    expect(isWordBoundary(".")).toBe(true);
  });

  it("returns false for alphanumeric", () => {
    expect(isWordBoundary("a")).toBe(false);
    expect(isWordBoundary("9")).toBe(false);
  });
});
