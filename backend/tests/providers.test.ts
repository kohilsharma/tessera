import { afterEach, describe, expect, it } from "vitest";
import { createEmbeddingProvider } from "../src/embeddings";
import { createSynthesisProvider } from "../src/synthesis";

// ADR-0003: a provider is chosen by env config, never hardcoded. These are the
// selection rules themselves — the seam that lets NVIDIA, Gemini, DeepSeek or
// any OpenAI-compatible gateway be swapped in without touching a service.
const KEYS = [
  "EMBEDDING_PROVIDER", "EMBEDDING_API_KEY", "GEMINI_API_KEY",
  "SYNTHESIS_PROVIDER", "SYNTHESIS_API_KEY",
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("provider selection", () => {
  it("falls back to the Mock providers when no key is configured", () => {
    expect(createEmbeddingProvider().constructor.name).toBe("MockEmbeddingProvider");
    expect(createSynthesisProvider().constructor.name).toBe("MockSynthesisProvider");
  });

  it("infers the hosted provider from whichever key is present", () => {
    process.env.EMBEDDING_API_KEY = "k";
    process.env.SYNTHESIS_API_KEY = "k";
    expect(createEmbeddingProvider().constructor.name).toBe("OpenAIEmbeddingProvider");
    expect(createSynthesisProvider().constructor.name).toBe("OpenAICompatibleSynthesisProvider");
  });

  // An existing Gemini-only .env has to keep working untouched.
  it("still selects Gemini when only GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "k";
    expect(createEmbeddingProvider().constructor.name).toBe("GeminiEmbeddingProvider");
  });

  it("lets an explicit choice override an inferred one", () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.EMBEDDING_API_KEY = "k";
    process.env.EMBEDDING_PROVIDER = "openai";
    expect(createEmbeddingProvider().constructor.name).toBe("OpenAIEmbeddingProvider");
    process.env.EMBEDDING_PROVIDER = "mock";
    expect(createEmbeddingProvider().constructor.name).toBe("MockEmbeddingProvider");
  });

  it("refuses a provider it has no key for, rather than silently degrading", () => {
    process.env.SYNTHESIS_PROVIDER = "openai";
    expect(() => createSynthesisProvider()).toThrow(/SYNTHESIS_API_KEY/);
    process.env.EMBEDDING_PROVIDER = "gemini";
    expect(() => createEmbeddingProvider()).toThrow(/GEMINI_API_KEY/);
  });

  // ADR-0002's invariant reaches down even into the Mock: a claim carries
  // citations into the evidence it was given, or it is not a claim.
  it("returns deterministic cited JSON from the Mock synthesis provider", async () => {
    const mock = createSynthesisProvider();
    const out = await mock.complete({ prompt: "[a1] first\n[a2] second", json: true });
    const parsed = JSON.parse(out);
    expect(parsed.claims[0].citations).toEqual(["a1", "a2"]);
    expect(await mock.complete({ prompt: "[a1] first\n[a2] second", json: true })).toBe(out);
  });
});
