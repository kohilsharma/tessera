import { Router } from "express";
import { AppDataSource } from "../data-source";
import { IngestionConnector } from "../entities/IngestionConnector";
import { enqueueConnectorRun } from "../ingestion/queue";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { isUuid } from "../lib/uuid";

export const ingestionRouter = Router();

// ADR-0004: operating ingestion is an Admin capability — a Student or Investor
// gets 403 here, and an anonymous caller 401 (requireAuth).
const adminOnly = [requireAuth, requireRole("admin")] as const;

async function findConnector(id: string): Promise<IngestionConnector | null> {
  if (!isUuid(id)) return null;
  return AppDataSource.getRepository(IngestionConnector).findOneBy({ id });
}

// #42: the trigger enqueues, and the worker executes. The scheduler feeds the
// same queue, so there is exactly one execution path — what is demoed is what
// runs. What the Admin surface reads afterwards is the IngestionRun row in
// Postgres (ADR-0024), never the queue, so the console renders with the worker
// stopped, which is most of the time.
ingestionRouter.post(
  "/ingestion/connectors/:id/run",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const connector = await findConnector(req.params.id);
    if (!connector) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }
    // Refusing a disabled connector is the whole point of the flag: a misbehaving
    // feed is stopped without a deploy. Checked here so the refusal is immediate
    // and legible; runConnector refuses it again on the way out of the queue, for
    // a connector disabled after its job was enqueued.
    // 422, not 409, for the same reason routes/auth.ts gives: the error contract
    // is 401/403/404/422, and a connector that is switched off is an invalid
    // target for this command rather than a separate conflict code.
    if (!connector.enabled) {
      res.status(422).json({ error: "Connector is disabled" });
      return;
    }

    // Enqueueing the same connector twice while its run is queued or in flight is
    // a no-op (see ingestion/queue.ts), so a second press is accepted and adds no
    // second run.
    await enqueueConnectorRun(connector.id);
    res.status(202).json({ connectorId: connector.id, status: "accepted" });
  }),
);

ingestionRouter.patch(
  "/ingestion/connectors/:id",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    if (typeof req.body?.enabled !== "boolean") {
      res.status(422).json({ error: "enabled must be a boolean" });
      return;
    }

    const connector = await findConnector(req.params.id);
    if (!connector) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    await AppDataSource.getRepository(IngestionConnector).update({ id: connector.id }, { enabled: req.body.enabled });
    res.json({ ...connector, enabled: req.body.enabled });
  }),
);
