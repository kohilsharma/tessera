import { Redis } from "ioredis";
import { rateLimit as expressRateLimit, type Options } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";

type Limits = { windowMs: number; max: number };

function store(): Options["store"] | undefined {
  if (!process.env.REDIS_URL || process.env.NODE_ENV === "test") return undefined;
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  return new RedisStore({
    prefix: "tessera:rate-limit:",
    sendCommand: async (...args: string[]) => (await (redis as any).call(args[0], ...args.slice(1))) as RedisReply,
  });
}

export function rateLimit({ windowMs, max }: Limits) {
  return expressRateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: true,
    store: store(),
    handler: (_req, res) => {
      res.locals.errorCode = "rate_limited";
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: "Too many requests", errorCode: "rate_limited" });
    },
  });
}

export function configuredRateLimit(prefix: string, defaults: Limits) {
  const windowMs = Number(process.env[`${prefix}_RATE_LIMIT_WINDOW_MS`] ?? defaults.windowMs);
  const max = Number(process.env[`${prefix}_RATE_LIMIT_MAX`] ?? defaults.max);
  return rateLimit({
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : defaults.windowMs,
    max: Number.isFinite(max) && max >= 0 ? max : defaults.max,
  });
}
