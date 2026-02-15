import { describe, it, expect, afterEach } from "vitest";
import {
  TokenCounter,
  createTokenCounter,
  formatTokenCount,
} from "./token-counter.js";

describe("TokenCounter", () => {
  afterEach(() => {
    // TokenCounter uses tiktoken encoders that should be freed; createTokenCounter
    // returns new instances so we don't hold refs here
  });

  it("uses cl100k_base for Grok model names and does not throw", () => {
    const counter = new TokenCounter("grok-4-1-fast-reasoning");
    expect(counter.countTokens("hello")).toBeGreaterThan(0);
    counter.dispose();
  });

  it("uses cl100k_base for grok-code-fast-1", () => {
    const counter = new TokenCounter("grok-code-fast-1");
    const count = counter.countTokens("Hello world");
    expect(count).toBeGreaterThan(0);
    counter.dispose();
  });

  it("counts tokens for a short string", () => {
    const counter = new TokenCounter("gpt-4");
    expect(counter.countTokens("Hi")).toBeGreaterThan(0);
    expect(counter.countTokens("")).toBe(0);
    counter.dispose();
  });

  it("fallback for unknown model uses cl100k_base", () => {
    const counter = new TokenCounter("unknown-model-xyz");
    expect(counter.countTokens("test")).toBeGreaterThan(0);
    counter.dispose();
  });
});

describe("createTokenCounter", () => {
  it("returns a TokenCounter instance", () => {
    const counter = createTokenCounter("grok-4");
    expect(counter).toBeInstanceOf(TokenCounter);
    expect(counter.countTokens("x")).toBe(1);
    counter.dispose();
  });
});

describe("formatTokenCount", () => {
  it("returns plain number for count <= 999", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(100)).toBe("100");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokenCount(1000)).toBe("1k");
    expect(formatTokenCount(1200)).toBe("1.2k");
    expect(formatTokenCount(15000)).toBe("15k");
  });

  it("formats millions with m suffix", () => {
    expect(formatTokenCount(1_000_000)).toBe("1m");
    expect(formatTokenCount(1_500_000)).toBe("1.5m");
  });
});
