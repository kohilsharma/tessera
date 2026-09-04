import Redis from "ioredis";

export type CacheClient = Pick<Redis, "get" | "set" | "del">;

const DEFAULT_TTL_SECONDS = 30;
let client: Redis | null = null;
let override: CacheClient | null | undefined;
let listenerAttached = false;

function redisClient(): CacheClient | null {
  if (override !== undefined) return override;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  client ??= new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 500,
  });
  // A cache outage must never become an unhandled Redis error event.
  if (!listenerAttached) {
    client.on("error", () => undefined);
    listenerAttached = true;
  }
  return client;
}

function ttlSeconds(): number {
  const configured = Number(process.env.COMPARABLE_STORIES_CACHE_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_TTL_SECONDS;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = redisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttl = ttlSeconds()): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch {
    // Redis is an optimization; callers continue with their source of truth.
  }
}

export async function cacheDelete(key: string): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // A stale value expires shortly, and the next read still has a DB fallback.
  }
}

export function setCacheClientForTests(next: CacheClient | null | undefined): void {
  override = next;
}

export async function closeCache(): Promise<void> {
  if (client) {
    client.disconnect();
    client = null;
    listenerAttached = false;
  }
}
