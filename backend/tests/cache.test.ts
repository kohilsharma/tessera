import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheDelete, cacheGet, cacheSet, setCacheClientForTests, type CacheClient } from "../src/lib/cache";
import { AppDataSource } from "../src/data-source";
import { comparableStories, invalidateComparableStoriesCache } from "../src/generation/evidence";
import { fakeRedis } from "./fakeCache";

afterEach(() => setCacheClientForTests(undefined));

describe("Redis cache seam", () => {
  it("round-trips JSON with an expiry and deletes explicitly", async () => {
    const redis = fakeRedis();
    setCacheClientForTests(redis);

    await cacheSet("key", { answer: 42 }, 17);
    expect(await cacheGet("key")).toEqual({ answer: 42 });
    expect(redis.ttl).toBe(17);

    await cacheDelete("key");
    expect(await cacheGet("key")).toBeNull();
  });

  it("fails open when the cache client is unavailable", async () => {
    const broken = {
      async get() {
        throw new Error("redis down");
      },
      async set() {
        throw new Error("redis down");
      },
      async del() {
        throw new Error("redis down");
      },
    } as CacheClient;
    setCacheClientForTests(broken);

    await expect(cacheGet("key")).resolves.toBeNull();
    await expect(cacheSet("key", { answer: 42 })).resolves.toBeUndefined();
    await expect(cacheDelete("key")).resolves.toBeUndefined();
  });

  it("serves comparable Stories from Redis after the first computation", async () => {
    const redis = fakeRedis();
    setCacheClientForTests(redis);
    const storyId = "00000000-0000-0000-0000-000000000081";
    const query = vi.spyOn(AppDataSource, "query").mockImplementation(async (sql: string) => {
      if (sql.includes('GROUP BY s."id"')) {
        return [{ id: storyId, title: "Cached Story", category: "technology", lastSeenAt: new Date("2026-01-01") }];
      }
      if (sql.includes('JOIN "articles" b')) return [];
      if (sql.includes('a."embedding" <=>')) {
        return [
          {
            articleId: "00000000-0000-0000-0000-000000000082",
            title: "First",
            url: "https://one.example/first",
            publishedAt: new Date("2026-01-01"),
            analysisText: "First report",
            analysisTextMode: "manual_fixture",
            publisherId: "00000000-0000-0000-0000-000000000083",
            publisherName: "One",
            publisherDomain: "one.example",
            termsClass: "licensed",
            distance: "0.1",
          },
          {
            articleId: "00000000-0000-0000-0000-000000000084",
            title: "Second",
            url: "https://two.example/second",
            publishedAt: new Date("2026-01-02"),
            analysisText: "Second report",
            analysisTextMode: "manual_fixture",
            publisherId: "00000000-0000-0000-0000-000000000085",
            publisherName: "Two",
            publisherDomain: "two.example",
            termsClass: "licensed",
            distance: "0.2",
          },
        ];
      }
      return [];
    });

    await expect(comparableStories()).resolves.toHaveLength(1);
    const callsAfterMiss = query.mock.calls.length;
    await expect(comparableStories()).resolves.toEqual([
      expect.objectContaining({ id: storyId, lastSeenAt: new Date("2026-01-01") }),
    ]);
    expect(query).toHaveBeenCalledTimes(callsAfterMiss);
    await invalidateComparableStoriesCache();
    await comparableStories();
    expect(query).toHaveBeenCalledTimes(callsAfterMiss + 3);
    query.mockRestore();
  });

  it("ignores malformed cached Stories", async () => {
    const redis = fakeRedis();
    redis.values.set("tessera:comparable-stories:v1", JSON.stringify([{ id: "story", category: "bogus" }]));
    setCacheClientForTests(redis);
    const query = vi.spyOn(AppDataSource, "query").mockResolvedValue([]);

    await expect(comparableStories()).resolves.toEqual([]);
    expect(query).toHaveBeenCalledOnce();
    query.mockRestore();
  });
});
