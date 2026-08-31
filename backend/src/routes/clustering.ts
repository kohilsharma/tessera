import { Router } from "express";
import { enqueueClusteringRun } from "../clustering/queue";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

export const clusteringRouter = Router();

// ADR-0004: operating the pipeline is an Admin capability — a Student or Investor
// gets 403 here, and an anonymous caller 401 (requireAuth).
//
// The trigger enqueues and the worker executes, exactly as ingestion's does (#42):
// the hourly scheduler feeds the same queue, so there is one execution path and
// what is demoed is what runs. History is read back from Postgres (ADR-0026), never
// the queue, so the Admin console renders with the worker stopped.
//
// A collection POST with no id, unlike ingestion's per-connector trigger: clustering
// is one pass over the whole corpus, so there is nothing to name in the path.
// Pressing it twice while a run is queued or in flight is a no-op (clustering/
// queue.ts), so a second press is accepted and adds no second run.
clusteringRouter.post(
  "/clustering/runs",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    await enqueueClusteringRun();
    res.status(202).json({ status: "accepted" });
  }),
);
