import { Router } from "express";
import { AppDataSource } from "../data-source";
import { CONNECTOR_KINDS, IngestionConnector, type ConnectorKind } from "../entities/IngestionConnector";
import { IngestionRun } from "../entities/IngestionRun";
import { enqueueConnectorRun } from "../ingestion/queue";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { isUuid } from "../lib/uuid";
import { isPgError, PG_UNIQUE_VIOLATION } from "../lib/pgError";

export const ingestionRouter = Router();

// ADR-0004: operating ingestion is an Admin capability — a Student or Investor
// gets 403 here, and an anonymous caller 401 (requireAuth).
const adminOnly = [requireAuth, requireRole("admin")] as const;

async function findConnector(id: string): Promise<IngestionConnector | null> {
  if (!isUuid(id)) return null;
  return AppDataSource.getRepository(IngestionConnector).findOneBy({ id });
}

function validateConnectorFields(body: Record<string, unknown>, partial: boolean): string | null {
  const allowed = ["name", "kind", "endpoint", "feedProvidesFullText", "enabled"];
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) return `${unknown} is not an accepted connector field`;
  if (!partial && (typeof body.name !== "string" || typeof body.kind !== "string" || typeof body.endpoint !== "string")) {
    return "name, kind, and endpoint are required";
  }
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) return "name must be a non-empty string";
  if (body.kind !== undefined && (typeof body.kind !== "string" || !CONNECTOR_KINDS.includes(body.kind as ConnectorKind))) {
    return `kind must be one of: ${CONNECTOR_KINDS.join(", ")}`;
  }
  if (body.endpoint !== undefined && (typeof body.endpoint !== "string" || !body.endpoint.trim())) return "endpoint must be a non-empty string";
  if (body.feedProvidesFullText !== undefined && body.feedProvidesFullText !== null && typeof body.feedProvidesFullText !== "boolean") {
    return "feedProvidesFullText must be a boolean or null";
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return "enabled must be a boolean";
  return null;
}

function connectorPayload(connector: IngestionConnector) {
  return {
    id: connector.id,
    name: connector.name,
    kind: connector.kind,
    endpoint: connector.endpoint,
    feedProvidesFullText: connector.feedProvidesFullText,
    enabled: connector.enabled,
  };
}

ingestionRouter.post(
  "/ingestion/connectors",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const error = validateConnectorFields(body, false);
    if (error) {
      res.status(422).json({ error });
      return;
    }
    const kind = body.kind as ConnectorKind;
    const connector = AppDataSource.getRepository(IngestionConnector).create({
      name: (body.name as string).trim(),
      kind,
      endpoint: (body.endpoint as string).trim(),
      feedProvidesFullText: kind === "rss" ? (body.feedProvidesFullText as boolean | null | undefined) ?? false : null,
      enabled: body.enabled === undefined ? true : (body.enabled as boolean),
    });
    try {
      await AppDataSource.getRepository(IngestionConnector).save(connector);
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION)) {
        res.status(422).json({ error: "Connector name is already in use" });
        return;
      }
      throw err;
    }
    res.status(201).json(connectorPayload(connector));
  }),
);

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
    const body = req.body ?? {};
    if (!Object.keys(body).length) {
      res.status(422).json({ error: "Provide at least one connector field" });
      return;
    }
    const error = validateConnectorFields(body, true);
    if (error) {
      res.status(422).json({ error });
      return;
    }

    const connector = await findConnector(req.params.id);
    if (!connector) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    if (body.name !== undefined) connector.name = (body.name as string).trim();
    if (body.kind !== undefined) connector.kind = body.kind as ConnectorKind;
    if (body.endpoint !== undefined) connector.endpoint = (body.endpoint as string).trim();
    if (body.feedProvidesFullText !== undefined) connector.feedProvidesFullText = body.feedProvidesFullText as boolean | null;
    if (body.enabled !== undefined) connector.enabled = body.enabled;
    if (connector.kind !== "rss") connector.feedProvidesFullText = null;
    try {
      await AppDataSource.getRepository(IngestionConnector).save(connector);
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION)) {
        res.status(422).json({ error: "Connector name is already in use" });
        return;
      }
      throw err;
    }
    res.json(connectorPayload(connector));
  }),
);

ingestionRouter.delete(
  "/ingestion/connectors/:id",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const connector = await findConnector(req.params.id);
    if (!connector) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }
    const runsRetained = await AppDataSource.getRepository(IngestionRun).countBy({ connectorId: connector.id });
    await AppDataSource.getRepository(IngestionConnector).remove(connector);
    res.json({
      id: connector.id,
      status: "deleted",
      runsRetained,
      message: runsRetained ? `Connector deleted; ${runsRetained} ingestion run${runsRetained === 1 ? "" : "s"} retained.` : "Connector deleted; no ingestion runs were recorded.",
    });
  }),
);
