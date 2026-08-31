import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../src/embeddings/EmbeddingProvider";
import { GeminiEmbeddingProvider } from "../src/embeddings/GeminiEmbeddingProvider";
import { createEmbeddingProvider } from "../src/embeddings";
import { createSynthesisProvider } from "../src/synthesis";

// ADR-0003: a provider is chosen by env config, never hardcoded. These are the
// selection rules themselves — the seam that lets NVIDIA, Gemini, DeepSeek or
// any OpenAI-compatible gateway be swapped in without touching a service.
const KEYS = [
  "EMBEDDING_PROVIDER", "EMBEDDING_API_KEY", "EMBEDDING_API_BASE", "EMBEDDING_MODEL", "GEMINI_API_KEY",
  "SYNTHESIS_PROVIDER", "SYNTHESIS_API_KEY", "SYNTHESIS_API_BASE", "SYNTHESIS_MODEL", "SYNTHESIS_ALLOWED_ORIGIN",
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
  vi.unstubAllGlobals();
});

describe("provider selection", () => {
  it("falls back to the Mock providers when no key is configured", () => {
    expect(createEmbeddingProvider().constructor.name).toBe("MockEmbeddingProvider");
    expect(createSynthesisProvider().constructor.name).toBe("MockSynthesisProvider");
  });

  it("infers the hosted provider from whichever key is present", () => {
    process.env.EMBEDDING_API_KEY = "k";
    process.env.EMBEDDING_API_BASE = "https://embeddings.example/v1";
    process.env.EMBEDDING_MODEL = "embedding-model";
    process.env.SYNTHESIS_API_KEY = "k";
    process.env.SYNTHESIS_API_BASE = "https://approved.example/v1";
    process.env.SYNTHESIS_ALLOWED_ORIGIN = "https://approved.example";
    process.env.SYNTHESIS_MODEL = "synthesis-model";
    expect(createEmbeddingProvider().constructor.name).toBe("OpenAIEmbeddingProvider");
    expect(createSynthesisProvider().constructor.name).toBe("OpenAICompatibleSynthesisProvider");
  });

  // An existing Gemini-only .env has to keep working untouched.
  it("still selects Gemini when only GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.EMBEDDING_MODEL = "gemini-embedding-model";
    expect(createEmbeddingProvider().constructor.name).toBe("GeminiEmbeddingProvider");
  });

  it("lets an explicit choice override an inferred one", () => {
    process.env.GEMINI_API_KEY = "k";
    process.env.EMBEDDING_API_KEY = "k";
    process.env.EMBEDDING_API_BASE = "https://embeddings.example/v1";
    process.env.EMBEDDING_MODEL = "embedding-model";
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

  it("refuses unknown provider names instead of silently falling through", () => {
    process.env.EMBEDDING_PROVIDER = "typo";
    expect(() => createEmbeddingProvider()).toThrow(/EMBEDDING_PROVIDER/);
    process.env.SYNTHESIS_PROVIDER = "typo";
    expect(() => createSynthesisProvider()).toThrow(/SYNTHESIS_PROVIDER/);
  });

  it("requires hosted model configuration instead of hardcoding model ids", () => {
    process.env.EMBEDDING_API_KEY = "k";
    process.env.EMBEDDING_API_BASE = "https://embeddings.example/v1";
    expect(() => createEmbeddingProvider()).toThrow(/EMBEDDING_MODEL/);

    process.env.SYNTHESIS_API_KEY = "k";
    process.env.SYNTHESIS_API_BASE = "https://approved.example/v1";
    process.env.SYNTHESIS_ALLOWED_ORIGIN = "https://approved.example";
    expect(() => createSynthesisProvider()).toThrow(/SYNTHESIS_MODEL/);
  });

  it("refuses a synthesis destination outside the approved no-training origin", () => {
    process.env.SYNTHESIS_API_KEY = "k";
    process.env.SYNTHESIS_MODEL = "synthesis-model";
    process.env.SYNTHESIS_API_BASE = "https://unapproved.example/v1";
    process.env.SYNTHESIS_ALLOWED_ORIGIN = "https://approved.example";
    expect(() => createSynthesisProvider()).toThrow(/approved origin/);
  });

  it("refuses redirects before synthesis evidence can leave the approved origin", async () => {
    process.env.SYNTHESIS_API_KEY = "k";
    process.env.SYNTHESIS_MODEL = "synthesis-model";
    process.env.SYNTHESIS_API_BASE = "https://approved.example/v1";
    process.env.SYNTHESIS_ALLOWED_ORIGIN = "https://approved.example";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "done" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createSynthesisProvider().complete({ prompt: "frozen evidence" });

    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe("error");
  });

  // ADR-0002's invariant reaches down even into the Mock: a claim carries
  // citations into the evidence it was given, or it is not a claim.
  it("returns deterministic cited JSON from the Mock synthesis provider", async () => {
    const mock = createSynthesisProvider();
    const out = await mock.complete({ prompt: "[a1] first\n[a2] second", json: true });
    const parsed = JSON.parse(out);
    expect(parsed.claims[0].claim_type).toBe("consensus");
    expect(parsed.claims[0].citations).toEqual(["a1", "a2"]);
    expect(await mock.complete({ prompt: "[a1] first\n[a2] second", json: true })).toBe(out);
  });
});


describe("GeminiEmbeddingProvider", () => {
  it("embeds a batch in one request with the retrieval task type", async () => {
    const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embedding: { values },
        embeddings: [{ values }, { values }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiEmbeddingProvider("key", "gemini-test-model");
    const vectors = await provider.embedBatch(["first", "second"], "passage");

    expect(vectors).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("gemini-test-model:batchEmbedContents");
    const body = JSON.parse(init.body as string);
    expect(body.requests).toHaveLength(2);
    expect(body.requests.every((request: { taskType: string }) => request.taskType === "RETRIEVAL_DOCUMENT")).toBe(true);
  });
});