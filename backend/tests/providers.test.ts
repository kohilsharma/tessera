import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../src/embeddings/EmbeddingProvider";
import { GeminiEmbeddingProvider } from "../src/embeddings/GeminiEmbeddingProvider";
import { createEmbeddingProvider } from "../src/embeddings";
import { createSynthesisProvider } from "../src/synthesis";
import { createMarketProvider, quote } from "../src/market";
import { setCacheClientForTests } from "../src/lib/cache";
import { fakeRedis } from "./fakeCache";
import { STORY_CATEGORIES } from "../src/entities/Story";

// ADR-0003: a provider is chosen by env config, never hardcoded. These are the
// selection rules themselves — the seam that lets NVIDIA, Gemini, DeepSeek or
// any OpenAI-compatible gateway be swapped in without touching a service.
const KEYS = [
  "EMBEDDING_PROVIDER", "EMBEDDING_API_KEY", "EMBEDDING_API_BASE", "EMBEDDING_MODEL", "GEMINI_API_KEY",
  "SYNTHESIS_PROVIDER", "SYNTHESIS_API_KEY", "SYNTHESIS_API_BASE", "SYNTHESIS_MODEL", "SYNTHESIS_ALLOWED_ORIGIN",
  "MARKET_PROVIDER", "MARKET_API_KEY", "MARKET_API_BASE", "MARKET_QUOTE_CACHE_TTL_SECONDS",
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
  vi.unstubAllGlobals();
  setCacheClientForTests(undefined);
});

describe("provider selection", () => {
  it("falls back to the Mock providers when no key is configured", () => {
    expect(createEmbeddingProvider().constructor.name).toBe("MockEmbeddingProvider");
    expect(createSynthesisProvider().constructor.name).toBe("MockSynthesisProvider");
    expect(createMarketProvider().constructor.name).toBe("MockMarketProvider");
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

  // #51: a naming call carries a deadline, and the transport must actually cancel
  // the request rather than let it keep billing while the run moves on.
  it("passes a caller's deadline to the request as an abort signal", async () => {
    process.env.SYNTHESIS_API_KEY = "k";
    process.env.SYNTHESIS_MODEL = "synthesis-model";
    process.env.SYNTHESIS_API_BASE = "https://approved.example/v1";
    process.env.SYNTHESIS_ALLOWED_ORIGIN = "https://approved.example";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createSynthesisProvider().complete({ prompt: "name this", timeoutMs: 15_000 });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);

    // No deadline asked for, none imposed: synthesis calls are long by nature.
    await createSynthesisProvider().complete({ prompt: "name this" });
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal).toBeUndefined();
  });

  // The half of that deadline the signal on `fetch` does not cover: a rate limiter
  // asking us to wait two minutes must not park a caller with a 15-second budget
  // (worker concurrency is 1, so that stalls the whole queue).
  it("stops waiting out a Retry-After once the deadline has passed", async () => {
    process.env.SYNTHESIS_API_KEY = "k";
    process.env.SYNTHESIS_MODEL = "synthesis-model";
    process.env.SYNTHESIS_API_BASE = "https://approved.example/v1";
    process.env.SYNTHESIS_ALLOWED_ORIGIN = "https://approved.example";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (header: string) => (header === "retry-after" ? "120" : null) },
      text: async () => "slow down",
    });
    vi.stubGlobal("fetch", fetchMock);

    const startedAt = Date.now();
    await expect(createSynthesisProvider().complete({ prompt: "name this", timeoutMs: 20 })).rejects.toThrow(/429/);

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  // The Mock answers by task, because `json` alone does not say which JSON (#51).
  it("names a Story deterministically and in vocabulary from the Mock", async () => {
    const mock = createSynthesisProvider();
    const prompt = "These headlines all report the same event:\n- Talks resume\n- Talks reopen";
    const out = await mock.complete({ task: "story_name", prompt, json: true });
    const parsed = JSON.parse(out) as { title: string; category: string };

    expect(parsed.title).toBe("[mock] Talks resume");
    expect(STORY_CATEGORIES).toContain(parsed.category);
    expect(await mock.complete({ task: "story_name", prompt, json: true })).toBe(out);
  });
});


// #87 / ADR-0036: the third instance of the same selection rule, so the market panel
// runs offline on the code path a key switches to a live provider.
describe("market provider", () => {
  // One real Tiingo IEX row, kept as the endpoint actually answers it.
  const TIINGO_ROW = {
    ticker: "AAPL",
    timestamp: "2026-09-03T20:00:00+00:00",
    last: null,
    tngoLast: 328.21,
    prevClose: 324.96,
  };

  function stubTiingo(response: unknown, ok = true) {
    const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 429, json: async () => response });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function configureTiingo() {
    process.env.MARKET_API_KEY = "tiingo-token";
    process.env.MARKET_API_BASE = "https://api.tiingo.com";
  }

  it("infers Tiingo from the key and lets an explicit choice override it", () => {
    configureTiingo();
    expect(createMarketProvider().constructor.name).toBe("TiingoMarketProvider");
    process.env.MARKET_PROVIDER = "mock";
    expect(createMarketProvider().constructor.name).toBe("MockMarketProvider");
  });

  it("refuses a provider it has no key for, and an unknown name", () => {
    process.env.MARKET_PROVIDER = "tiingo";
    expect(() => createMarketProvider()).toThrow(/MARKET_API_KEY/);
    process.env.MARKET_PROVIDER = "typo";
    expect(() => createMarketProvider()).toThrow(/MARKET_PROVIDER/);
  });

  it("requires an https endpoint from configuration rather than hardcoding one", () => {
    process.env.MARKET_API_KEY = "tiingo-token";
    expect(() => createMarketProvider()).toThrow(/MARKET_API_BASE/);
    process.env.MARKET_API_BASE = "http://api.tiingo.com";
    expect(() => createMarketProvider()).toThrow(/https/);
  });

  it("maps a Tiingo quote and sends the token as a header, not a query parameter", async () => {
    configureTiingo();
    const fetchMock = stubTiingo([TIINGO_ROW]);

    const quoted = await createMarketProvider().quote("AAPL");
    expect(quoted).toEqual({
      ticker: "AAPL",
      price: 328.21,
      change: expect.closeTo(3.25, 2),
      changePercent: expect.closeTo(1.0001, 3),
      previousClose: 324.96,
      asOf: "2026-09-03T20:00:00.000Z",
      source: "tiingo",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tiingo.com/iex/?tickers=AAPL");
    expect(url).not.toContain("tiingo-token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Token tiingo-token");
    expect(init.redirect).toBe("error");
  });

  // Tiingo answers an unknown Ticker with an empty array rather than a zeroed row.
  it("reads an empty Tiingo response as no quote, and a failure as a throw", async () => {
    configureTiingo();
    stubTiingo([]);
    expect(await createMarketProvider().quote("NOTATICKER")).toBeNull();

    stubTiingo({}, false);
    await expect(createMarketProvider().quote("AAPL")).rejects.toThrow(/429/);
  });

  it("answers deterministically from the Mock, and differently per Ticker", async () => {
    const mock = createMarketProvider();
    const first = await mock.quote("AAPL");
    expect(await mock.quote("AAPL")).toEqual(first);
    expect(first?.source).toBe("mock");
    expect(first?.price).toBeGreaterThan(0);
    expect((await mock.quote("MSFT"))?.price).not.toBe(first?.price);
    // The day's move has to be consistent with the close a panel draws it against.
    expect(first?.price).toBeCloseTo((first?.previousClose ?? 0) + (first?.change ?? 0), 1);
  });

  it("serves a cached quote instead of calling the provider again", async () => {
    configureTiingo();
    const redis = fakeRedis();
    setCacheClientForTests(redis);
    const fetchMock = stubTiingo([TIINGO_ROW]);

    expect((await quote("aapl"))?.price).toBe(328.21);
    expect((await quote("AAPL"))?.price).toBe(328.21);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(redis.values.has("tessera:quote:v1:AAPL")).toBe(true);
    expect(redis.ttl).toBe(60);

    process.env.MARKET_QUOTE_CACHE_TTL_SECONDS = "5";
    await quote("MSFT");
    expect(redis.ttl).toBe(5);
  });

  // A Ticker nothing trades under is an answer, and re-asking it on every page read
  // would spend the free tier's whole budget on a row that will never resolve.
  it("caches a confirmed-unknown Ticker but never an outage", async () => {
    configureTiingo();
    setCacheClientForTests(fakeRedis());
    const unknown = stubTiingo([]);
    expect(await quote("ZZZZ")).toBeNull();
    expect(await quote("ZZZZ")).toBeNull();
    expect(unknown).toHaveBeenCalledOnce();

    const failing = stubTiingo({}, false);
    expect(await quote("AAPL")).toBeNull();
    expect(await quote("AAPL")).toBeNull();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("lets a misconfiguration throw rather than degrade into an empty panel", async () => {
    process.env.MARKET_PROVIDER = "tiingo";
    process.env.MARKET_API_KEY = "tiingo-token";
    process.env.MARKET_API_BASE = "http://api.tiingo.com";
    await expect(quote("AAPL")).rejects.toThrow(/https/);
  });

  it("refuses a string that is not a Ticker before it reaches a provider or a key", async () => {
    configureTiingo();
    const fetchMock = stubTiingo([TIINGO_ROW]);
    for (const bad of ["", "  ", "AAPL; DROP", "TOOLONGSYMBOL", "../../etc", "9AAPL"]) {
      expect(await quote(bad)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
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