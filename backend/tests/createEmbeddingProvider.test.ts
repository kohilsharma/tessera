import { afterEach, describe, expect, it } from "vitest";
import { createEmbeddingProvider } from "../src/embeddings";
import { GeminiEmbeddingProvider } from "../src/embeddings/GeminiEmbeddingProvider";
import { MockEmbeddingProvider } from "../src/embeddings/MockEmbeddingProvider";

describe("createEmbeddingProvider", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.EMBEDDING_MODEL;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.EMBEDDING_MODEL;
    else process.env.EMBEDDING_MODEL = originalModel;
  });

  it("falls back to MockEmbeddingProvider when no API key is configured", () => {
    delete process.env.GEMINI_API_KEY;
    expect(createEmbeddingProvider()).toBeInstanceOf(MockEmbeddingProvider);
  });

  it("uses Gemini once its key and model are configured", () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.EMBEDDING_MODEL = "gemini-test-model";
    expect(createEmbeddingProvider()).toBeInstanceOf(GeminiEmbeddingProvider);
  });
});
