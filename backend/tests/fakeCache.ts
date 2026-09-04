import type { CacheClient } from "../src/lib/cache";

// An in-memory stand-in for #81's Redis seam. The suite has no Redis (AGENTS.md), so
// anything that must prove a value was *stored* rather than recomputed needs this.
export type FakeCache = CacheClient & { values: Map<string, string>; ttl?: number };

export function fakeRedis(): FakeCache {
  const values = new Map<string, string>();
  return {
    values,
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async set(key: string, value: string, _mode: string, ttl: number) {
      values.set(key, value);
      this.ttl = ttl;
      return "OK";
    },
    async del(key: string) {
      values.delete(key);
      return 1;
    },
  } as FakeCache;
}
