import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../src/embeddings/EmbeddingProvider";
import { GeminiEmbeddingProvider } from "../src/embeddings/GeminiEmbeddingProvider";

const VALUES = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index / EMBEDDING_DIMENSIONS);

function stubFetch(values: number[] = VALUES) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ embeddings: [{ values }] }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GeminiEmbeddingProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses batchEmbedContents with the configured model and document task type", async () => {
    const fetchMock = stubFetch();
    const provider = new GeminiEmbeddingProvider("test-key", "gemini-test-model");

    await expect(provider.embed("hello world")).resolves.toEqual(VALUES);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("gemini-test-model:batchEmbedContents");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body.requests).toEqual([
      {
        model: "models/gemini-test-model",
        content: { parts: [{ text: "hello world" }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    ]);
  });

  it("returns a vector of exactly EMBEDDING_DIMENSIONS", async () => {
    stubFetch();
    const provider = new GeminiEmbeddingProvider("test-key", "gemini-test-model");
    await expect(provider.embed("hello")).resolves.toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("throws rather than returning a vector of the wrong width", async () => {
    stubFetch([1, 2, 3]);
    const provider = new GeminiEmbeddingProvider("test-key", "gemini-test-model");
    await expect(provider.embed("hello")).rejects.toThrow(
      new RegExp(`3 dimensions, expected ${EMBEDDING_DIMENSIONS}`),
    );
  });

  it("marks query embeddings separately from stored passages", async () => {
    const fetchMock = stubFetch();
    const provider = new GeminiEmbeddingProvider("test-key", "gemini-test-model");

    await provider.embed("search terms", "query");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).requests[0].taskType).toBe("RETRIEVAL_QUERY");
  });

  it("throws with the status and body text on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" }),
    );
    const provider = new GeminiEmbeddingProvider("test-key", "gemini-test-model");
    await expect(provider.embed("hello")).rejects.toThrow(/429.*rate limited/);
  });
});
