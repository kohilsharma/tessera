import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../src/embeddings/EmbeddingProvider";
import { GeminiEmbeddingProvider } from "../src/embeddings/GeminiEmbeddingProvider";

// A response of the width the provider is contracted to return (ADR-0017), so
// the dimension guard doesn't fire on the tests that aren't about it.
const VALUES = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / EMBEDDING_DIMENSIONS);

function stubFetch(values: number[] = VALUES) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ embedding: { values } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GeminiEmbeddingProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the configured model truncated to EMBEDDING_DIMENSIONS and returns its values", async () => {
    const fetchMock = stubFetch();

    const provider = new GeminiEmbeddingProvider("test-key");
    const result = await provider.embed("hello world");

    expect(result).toEqual(VALUES);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("gemini-embedding-001:embedContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body.content.parts[0].text).toBe("hello world");
    // embedContentConfig is the non-deprecated home for outputDimensionality on
    // the v1beta body; the model is carried by the URL, not repeated here.
    expect(body.embedContentConfig.outputDimensionality).toBe(EMBEDDING_DIMENSIONS);
    expect(body.model).toBeUndefined();
  });

  it("returns a vector of exactly EMBEDDING_DIMENSIONS", async () => {
    stubFetch();
    const provider = new GeminiEmbeddingProvider("test-key");
    await expect(provider.embed("hello")).resolves.toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("throws rather than returning a vector of the wrong width", async () => {
    // The failure this guards: outputDimensionality silently not applied, so the
    // model's native width comes back and only fails at the vector(1024) INSERT.
    stubFetch([1, 2, 3]);
    const provider = new GeminiEmbeddingProvider("test-key");
    await expect(provider.embed("hello")).rejects.toThrow(
      new RegExp(`3 dimensions, expected ${EMBEDDING_DIMENSIONS}`),
    );
  });

  it("accepts an explicit model override", async () => {
    const fetchMock = stubFetch();

    const provider = new GeminiEmbeddingProvider("test-key", "gemini-embedding-002");
    await provider.embed("hello");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("gemini-embedding-002:embedContent");
  });

  it("reads EMBEDDING_MODEL from the environment when no override is passed (ADR-0003: no hardcoded model IDs)", async () => {
    const original = process.env.EMBEDDING_MODEL;
    process.env.EMBEDDING_MODEL = "gemini-embedding-003";
    try {
      const fetchMock = stubFetch();

      const provider = new GeminiEmbeddingProvider("test-key");
      await provider.embed("hello");

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("gemini-embedding-003:embedContent");
    } finally {
      if (original === undefined) delete process.env.EMBEDDING_MODEL;
      else process.env.EMBEDDING_MODEL = original;
    }
  });

  it("falls back to the default model when EMBEDDING_MODEL is set but empty", async () => {
    const original = process.env.EMBEDDING_MODEL;
    process.env.EMBEDDING_MODEL = "";
    try {
      const fetchMock = stubFetch();
      await new GeminiEmbeddingProvider("test-key").embed("hello");

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("gemini-embedding-001:embedContent");
    } finally {
      if (original === undefined) delete process.env.EMBEDDING_MODEL;
      else process.env.EMBEDDING_MODEL = original;
    }
  });

  it("throws with the status and body text on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" }),
    );
    const provider = new GeminiEmbeddingProvider("test-key");
    await expect(provider.embed("hello")).rejects.toThrow(/429.*rate limited/);
  });
});
