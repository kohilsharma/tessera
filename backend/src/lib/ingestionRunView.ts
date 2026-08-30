import { IngestionRun } from "../entities/IngestionRun";

// The IngestionRun projection the Admin dashboard's history register is served
// from, in the same spirit as articleView.ts's toPublicArticle: one statement of
// the wire shape, so the mirror type in frontend/src/api/client.ts has one thing
// to mirror. Sole caller since #42 — the run endpoint answers with an
// acknowledgement now, because the run has not happened when it replies.
//
// The connector's name is passed in rather than read off `run.connector`, so a
// caller that already holds the connector need not load the relation again.
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
