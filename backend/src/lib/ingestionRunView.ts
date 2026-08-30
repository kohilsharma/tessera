import { IngestionRun } from "../entities/IngestionRun";

// The IngestionRun projection shared by the run endpoint and the Admin
// dashboard's history register, in the same spirit as articleView.ts's
// toPublicArticle: one statement of the wire shape, so the two callers cannot
// drift and the mirror type in frontend/src/api/client.ts has one thing to
// mirror.
//
// The connector's name is passed in rather than read off `run.connector`: the run
// endpoint already holds the connector it just ran, and the dashboard loads the
// relation — requiring the relation here would make the endpoint re-fetch a row
// it has.
//
// `cursor` is deliberately not served. It is where the connector got to in its
// source's own terms, kept for the scheduler's benefit (#45); nothing on the
// operator surface reads it, and an unread field on the wire is one the client
// has to decide how to ignore.
export function toPublicIngestionRun(run: IngestionRun, connectorName: string) {
  return {
    id: run.id,
    connectorId: run.connectorId,
    connectorName,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    discovered: run.discovered,
    inserted: run.inserted,
    enriched: run.enriched,
    duplicate: run.duplicate,
    rejectedByPolicy: run.rejectedByPolicy,
    failed: run.failed,
    errorSummary: run.errorSummary,
  };
}
