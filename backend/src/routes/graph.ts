import { Router } from "express";
import { enqueueEntityResolutionRun } from "../graph/queue";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

export const graphRouter = Router();

// ADR-0004: operating the pipeline is an Admin capability — a Student or Investor gets
// 403 here, and an anonymous caller 401 (requireAuth).
const adminOnly = [requireAuth, requireRole("admin")] as const;

// The trigger enqueues and the worker executes, exactly as ingestion's and
// clustering's do: the hourly scheduler feeds the same queue, so there is one
// execution path and what is demoed is what runs. History is read back from Postgres,
// never the queue, so the Admin console renders with the worker stopped.
//
// A collection POST with no id: a pass is one rebuild over every staged annotation, so
// there is nothing to name in the path. Pressing it twice while a pass is queued or in
// flight is a no-op (graph/queue.ts), so a second press is accepted and adds no second
// pass.
graphRouter.post(
  "/graph/resolution-runs",
  ...adminOnly,
  asyncHandler(async (_req, res) => {
    await enqueueEntityResolutionRun();
    res.status(202).json({ status: "accepted" });
  }),
);
