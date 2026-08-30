import { Router } from "express";
import { AppDataSource } from "../data-source";
import { IngestionConnector } from "../entities/IngestionConnector";
import { httpFetchText, runConnector } from "../ingestion/runConnector";
import { toPublicIngestionRun } from "../lib/ingestionRunView";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { isUuid } from "../lib/uuid";

export const ingestionRouter = Router();

// ADR-0004: operating ingestion is an Admin capability — a Student or Investor
// gets 403 here, and an anonymous caller 401 (requireAuth).
const adminOnly = [requireAuth, requireRole("admin")] as const;

function connectorRepo() {
  return AppDataSource.getRepository(IngestionConnector);
}

async function findConnector(id: string): Promise<IngestionConnector | null> {
  if (!isUuid(id)) return null;
  return connectorRepo().findOneBy({ id });
}

// #39 runs the connector inline; #42 flips this to an enqueue onto the BullMQ
// queue the worker drains. The response shape does not change, because what the
// Admin surface reads afterwards is the IngestionRun row in Postgres either way
// (ADR-0024) — never the queue.
ingestionRouter.post(
  "/ingestion/connectors/:id/run",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const connector = await findConnector(req.params.id);
    if (!connector) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    const run = await runConnector(connector, { fetchText: httpFetchText });
    // runConnector refuses a disabled connector, and refusing is the whole point
    // of the flag: a misbehaving feed is stopped without a deploy.
    // 422, not 409, for the same reason routes/auth.ts gives: the error contract
    // is 401/403/404/422, and a connector that is switched off is an invalid
    // target for this command rather than a separate conflict code.
    if (!run) {
      res.status(422).json({ error: "Connector is disabled" });
      return;
    }

    res.status(201).json(toPublicIngestionRun(run, connector.name));
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

    await connectorRepo().update({ id: connector.id }, { enabled: req.body.enabled });
    res.json({ ...connector, enabled: req.body.enabled });
  }),
);
