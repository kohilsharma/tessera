import express, { type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { storiesRouter } from "./routes/stories";
import { articlesRouter } from "./routes/articles";
import { briefsRouter } from "./routes/briefs";
import { searchRouter } from "./routes/search";
import { ingestionRouter } from "./routes/ingestion";
import { clusteringRouter } from "./routes/clustering";
import { graphRouter } from "./routes/graph";
import { generationRouter } from "./routes/generation";
import { promptsRouter } from "./routes/prompts";
import { flashcardsRouter } from "./routes/flashcards";
import { log, logger } from "./lib/logger";
import pinoHttp from "pino-http";
import { configuredRateLimit } from "./middleware/rateLimit";

// Last resort for anything an async handler rejects with (a DB fault, a bug):
// one 500 with nothing internal leaked, instead of an unhandled rejection.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  res.locals.errorCode = "internal_error";
  void err;
  res.status(500).json({ error: "Internal server error" });
};

export function createApp() {
  const app = express();
  app.use(
    pinoHttp({
      logger,
      autoLogging: false,
      genReqId: (req) =>
        typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : randomUUID(),
    }),
  );
  app.use((req, res, next) => {
    const requestId = req.id;
    res.setHeader("X-Request-Id", String(requestId));
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const body = req.body as Record<string, unknown> | undefined;
      const storyId = req.originalUrl.match(/\/stories\/([^/?]+)/)?.[1];
      const connectorId = req.originalUrl.match(/\/connectors\/([^/?]+)/)?.[1];
      log(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info", "request.completed", {
        requestId,
        userId: req.user?.id,
        connectorId: connectorId ?? body?.connectorId,
        runId: body?.runId,
        storyId: storyId ?? body?.storyId,
        generationRunId: body?.generationRunId,
        durationMs: Math.round(durationMs * 100) / 100,
        resultStatus: res.statusCode,
        errorCode: res.locals.errorCode ?? (res.statusCode >= 400 ? `http_${res.statusCode}` : undefined),
        method: req.method,
        path: req.originalUrl,
      });
    });
    next();
  });
  app.use(express.json());
  app.use("/api/v1", healthRouter);
  const authLimiter = configuredRateLimit("AUTH", { windowMs: 60_000, max: 30 });
  app.use("/api/v1", (req, res, next) => {
    if (/^\/auth\/(register|login)\/?$/.test(req.path)) return authLimiter(req, res, next);
    next();
  }, authRouter);
  app.use("/api/v1", dashboardRouter);
  const generationLimiter = configuredRateLimit("GENERATION", { windowMs: 60_000, max: 10 });
  app.post("/api/v1/stories/:id/market-read", generationLimiter);
  app.use("/api/v1", storiesRouter);
  app.use("/api/v1", articlesRouter);
  app.use("/api/v1", briefsRouter);
  app.use("/api/v1", searchRouter);
  app.use("/api/v1", ingestionRouter);
  app.use("/api/v1", clusteringRouter);
  app.use("/api/v1", graphRouter);
  app.post("/api/v1/stories/:id/analysis", generationLimiter);
  app.post("/api/v1/flashcards", generationLimiter);
  app.use("/api/v1", generationRouter);
  app.use("/api/v1", promptsRouter);
  app.use("/api/v1", flashcardsRouter);
  app.use(errorHandler);
  return app;
}
