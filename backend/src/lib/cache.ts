import Redis from "ioredis";

export type CacheClient = Pick<Redis, "get" | "set" | "del">;

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

// Every cached surface tunes its own TTL from its own key, so reading one lives here
// rather than being copied beside each caller.
export function ttlFromEnv(key: string, fallback: number): number {
  const configured = Number(process.env[key]);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
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

// The TTL is the caller's, always: how long a surface may serve a stale answer is a
// fact about that surface, and a default here would make it a fact about Redis.
export async function cacheSet<T>(key: string, value: T, ttl: number): Promise<void> {
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
