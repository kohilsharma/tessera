import { afterEach, describe, expect, it } from "vitest";
import { createEmbeddingProvider } from "../src/embeddings";
import { GeminiEmbeddingProvider } from "../src/embeddings/GeminiEmbeddingProvider";
import { MockEmbeddingProvider } from "../src/embeddings/MockEmbeddingProvider";

describe("createEmbeddingProvider", () => {
  const original = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original;
  });

  it("falls back to MockEmbeddingProvider when no API key is configured (ADR-0003's test/no-key rule)", () => {
    delete process.env.GEMINI_API_KEY;
    expect(createEmbeddingProvider()).toBeInstanceOf(MockEmbeddingProvider);
  });

  it("uses the hosted GeminiEmbeddingProvider once GEMINI_API_KEY is set (ADR-0023)", () => {
    process.env.GEMINI_API_KEY = "test-key";
    expect(createEmbeddingProvider()).toBeInstanceOf(GeminiEmbeddingProvider);
  });
});
