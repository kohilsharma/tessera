import express, { type ErrorRequestHandler } from "express";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { storiesRouter } from "./routes/stories";
import { articlesRouter } from "./routes/articles";
import { briefsRouter } from "./routes/briefs";
import { searchRouter } from "./routes/search";
import { ingestionRouter } from "./routes/ingestion";
import { clusteringRouter } from "./routes/clustering";
import { generationRouter } from "./routes/generation";
import { promptsRouter } from "./routes/prompts";
import { flashcardsRouter } from "./routes/flashcards";

// Last resort for anything an async handler rejects with (a DB fault, a bug):
// one 500 with nothing internal leaked, instead of an unhandled rejection.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("Unhandled error while serving request", err);
  res.status(500).json({ error: "Internal server error" });
};

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", healthRouter);
  app.use("/api/v1", authRouter);
  app.use("/api/v1", dashboardRouter);
  app.use("/api/v1", storiesRouter);
  app.use("/api/v1", articlesRouter);
  app.use("/api/v1", briefsRouter);
  app.use("/api/v1", searchRouter);
  app.use("/api/v1", ingestionRouter);
  app.use("/api/v1", clusteringRouter);
  app.use("/api/v1", generationRouter);
  app.use("/api/v1", promptsRouter);
  app.use("/api/v1", flashcardsRouter);
  app.use(errorHandler);
  return app;
}
