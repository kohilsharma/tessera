import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "../src/middleware/rateLimit";
import { createApp, errorHandler } from "../src/app";
import { logger } from "../src/lib/logger";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AUTH_RATE_LIMIT_MAX;
  delete process.env.GENERATION_RATE_LIMIT_MAX;
});

describe("rate limiting", () => {
  it("returns 429 with retry metadata after the configured window is exhausted", async () => {
    const app = express();
    app.use(rateLimit({ max: 2, windowMs: 60_000 }));
    app.get("/", (_req, res) => res.json({ ok: true }));

    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(200);
    const limited = await request(app).get("/");

    expect(limited.status).toBe(429);
    expect(limited.headers["x-ratelimit-limit"]).toBe("2");
    expect(limited.headers["retry-after"]).toEqual(expect.any(String));
    expect(limited.body).toEqual({ error: "Too many requests", errorCode: "rate_limited" });
  });

  it("limits login without consuming the quota on unrelated API routes", async () => {
    process.env.AUTH_RATE_LIMIT_MAX = "1";
    const app = createApp();

    expect((await request(app).post("/api/v1/auth/login").send({})).status).toBe(422);
    expect((await request(app).post("/api/v1/auth/login/").send({})).status).toBe(429);
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
  });

  it.each([
    "/api/v1/stories/not-a-uuid/analysis",
    "/api/v1/stories/not-a-uuid/market-read",
    "/api/v1/flashcards",
    "/api/v1/flashcards/search",
  ])(
    "limits the expensive generation endpoint %s",
    async (path) => {
      process.env.GENERATION_RATE_LIMIT_MAX = "1";
      const app = createApp();

      expect((await request(app).post(path).send({})).status).toBe(401);
      expect((await request(app).post(path).send({})).status).toBe(429);
    },
  );
});

describe("request observability", () => {
  it("echoes a request id and emits a structured completion event", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const response = await request(createApp()).get("/api/v1/health").set("X-Request-Id", "request-test-1");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe("request-test-1");
    const event = info.mock.calls.map(([fields]) => fields as Record<string, unknown>).find((entry) => entry.event === "request.completed");
    if (!event) throw new Error("request.completed event was not logged");
    expect(event).toMatchObject({ requestId: "request-test-1", method: "GET", resultStatus: 200 });
    expect(event.durationMs).toEqual(expect.any(Number));
  });

  it("logs the exception behind a 500 rather than only its status", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);
    // The app's own handler over a route that throws — mounted here rather than in
    // `createApp`, since error middleware only catches what is registered above it.
    const app = express();
    app.get("/boom", () => {
      throw new Error("nothing behind this door");
    });
    app.use(errorHandler);
    const response = await request(app).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal server error" });
    const failure = error.mock.calls.map(([fields]) => fields as Record<string, unknown>).find((entry) => entry.event === "request.failed");
    if (!failure) throw new Error("request.failed event was not logged");
    expect(failure).toMatchObject({ path: "/boom", error: "nothing behind this door" });
  });
});
