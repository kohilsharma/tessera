import { afterEach, describe, expect, it } from "vitest";
import { setCacheClientForTests } from "../src/lib/cache";
import { generateMarketRead, validateMarketRead, type MarketReadInput } from "../src/market/marketRead";
import type { SynthesisProvider } from "../src/synthesis";
import { fakeRedis } from "./fakeCache";

const input: MarketReadInput = {
  storyId: "story-1",
  reporting: [
    { evidenceId: "A1", articleId: "article-1", publisherName: "Northwind Ledger", title: "Licence change reported", excerpt: "The company changed its licence terms." },
    { evidenceId: "A2", articleId: "article-2", publisherName: "Harbour Dispatch", title: "Approval remains pending", excerpt: "Officials said the approval remains pending." },
  ],
  markets: [
    { ticker: "NWD", canonicalName: "Northwind", price: 104.4, change: 1.2, changePercent: 1.16, sma50: 100, rsi14: 61, volatility: 24.4 },
  ],
};

afterEach(() => setCacheClientForTests(undefined));

describe("market read", () => {
  it("accepts a cited read and rejects advice-shaped output", () => {
    expect(validateMarketRead(JSON.stringify({ read: "Trading 4.4% above its 50-day average while outlets report the licence change.", citations: ["A1", "A2"] }), new Map([["A1", "article-1"], ["A2", "article-2"]]))).toEqual({
      ok: true,
      read: "Trading 4.4% above its 50-day average while outlets report the licence change.",
      citations: ["A1", "A2"],
    });
    expect(validateMarketRead(JSON.stringify({ read: "Consider accumulating NWD.", citations: ["A1"] }), new Map([["A1", "article-1"]]))).toEqual({
      ok: false,
      code: "prohibited_investor_language",
    });
    expect(validateMarketRead(JSON.stringify({ read: "The licence change caused the price increase.", citations: ["A1"] }), new Map([["A1", "article-1"]]))).toEqual({ ok: false, code: "prohibited_investor_language" });
  });

  it("caches by content hash and does not call the provider twice", async () => {
    const redis = fakeRedis();
    setCacheClientForTests(redis);
    let calls = 0;
    const provider: SynthesisProvider = {
      complete: async (request) => {
        calls += 1;
        expect(request.task).toBe("market_read");
        expect(request.prompt).toContain("104.40");
        return JSON.stringify({ read: "The reporting describes the licence change while NWD trades above its 50-day average.", citations: ["A1", "A2"] });
      },
    };

    const first = await generateMarketRead(provider, input, "mock", "mock");
    const second = await generateMarketRead(provider, input, "mock", "mock");
    expect(first).toEqual(second);
    if ("refused" in first) throw new Error(`expected a read, got ${first.refused}`);
    expect(first.read).toContain("licence change");
    expect(first.citations).toEqual(["A1", "A2"]);
    expect(calls).toBe(1);
    expect([...redis.values.keys()][0]).toMatch(/^tessera:market-read:v1:/);
  });

  it("refuses rather than throws, and never caches the refusal", async () => {
    const redis = fakeRedis();
    setCacheClientForTests(redis);
    const provider: SynthesisProvider = {
      async complete() {
        return "I cannot answer that.";
      },
    };

    const outcome = await generateMarketRead(provider, input, "mock", "mock");

    expect(outcome).toEqual({ refused: "unparseable_output" });
    expect([...redis.values.keys()]).toHaveLength(0);
  });
});
