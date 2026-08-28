import express, { type ErrorRequestHandler } from "express";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";
import { storiesRouter } from "./routes/stories";
import { articlesRouter } from "./routes/articles";
import { briefsRouter } from "./routes/briefs";
import { UPLOADS_DIR } from "./storage/LocalDiskFileStorageProvider";

// Last resort for anything an async handler rejects with (a DB fault, a bug):
// one 500 with nothing internal leaked, instead of an unhandled rejection.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("Unhandled error while serving request", err);
  res.status(500).json({ error: "Internal server error" });
};

export function createApp() {
  const app = express();
  app.use(express.json());
  // Brief cover images (#21): LocalDiskFileStorageProvider.url() points here,
  // so swapping in an S3/GCS FileStorageProvider later needs no route change —
  // only that provider's url() would return an external URL instead.
  // ponytail: unauthenticated, unlike every other Brief route — an <img> tag
  // can't carry the app's bearer token, and the key is an unguessable random
  // UUID (routes/briefs.ts), so this trades strict per-owner access control for
  // a capability-URL like most image CDNs use. Revisit with a signed/expiring
  // URL (or a fetch+blob-URL <img> in the SPA) if Brief cover images need to
  // stay private rather than merely unlisted.
  app.use("/api/v1/media", express.static(UPLOADS_DIR));
  // express.static calls next() on a miss instead of 404ing; without this, a
  // request for a deleted/unknown key would fall through into briefsRouter's
  // router-wide requireAuth (registered path-less, so it runs for anything
  // under /api/v1 that no earlier router claims) and come back 401 instead.
  app.use("/api/v1/media", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use("/api/v1", healthRouter);
  app.use("/api/v1", authRouter);
  app.use("/api/v1", dashboardRouter);
  app.use("/api/v1", storiesRouter);
  app.use("/api/v1", articlesRouter);
  app.use("/api/v1", briefsRouter);
  app.use(errorHandler);
  return app;
}
