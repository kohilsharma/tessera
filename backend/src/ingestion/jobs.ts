import { AppDataSource } from "../data-source";
import { IngestionConnector } from "../entities/IngestionConnector";
import { RUN_JOB, TICK_JOB, enqueueConnectorRun, type RunJobData } from "./queue";
import { pruneExpiredGkgArticles } from "./retention";
import { httpFetchText, runConnector } from "./runConnector";

// What the worker actually does, kept out of src/worker.ts for the same reason
// app.ts is kept out of index.ts: the entrypoint owns the process, this owns the
// behaviour, and tests can drive the behaviour without one.

// The scheduler's fan-out. Disabled connectors are filtered here *and* refused by
// runConnector — this one keeps the queue from filling with jobs that would do
// nothing, that one is the rule (#39), and a connector disabled between the tick
// and the dequeue is why both exist.
export async function enqueueEnabledConnectors(): Promise<number> {
  const connectors = await AppDataSource.getRepository(IngestionConnector).findBy({ enabled: true });
  for (const connector of connectors) await enqueueConnectorRun(connector.id);
  return connectors.length;
}

// One job. Named jobs rather than one handler per queue so the tick and a run
// share the worker's concurrency of 1 (see src/worker.ts) — which is the second
// half of "no two concurrent runs", the first being the per-connector job id.
export async function runIngestionJob(job: { name: string; data: Partial<RunJobData> }): Promise<void> {
  if (job.name === TICK_JOB) {
    const enqueued = await enqueueEnabledConnectors();
    // Retention rides the tick rather than owning a schedule of its own: it is
    // the same 15-minute clock, and one pass per tick keeps each pass to a
    // window's worth of rows. Enqueued first, so a prune that throws cannot hold
    // the fleet up — it fails the tick job, which the worker logs.
    const pruned = await pruneExpiredGkgArticles();
    console.log(`[worker] tick enqueued ${enqueued} connector(s), pruned ${pruned} expired GKG article(s)`);
    return;
  }
  if (job.name !== RUN_JOB) throw new Error(`Unknown ingestion job "${job.name}"`);

  const connectorId = job.data.connectorId;
  if (!connectorId) throw new Error(`${RUN_JOB} job has no connectorId`);
  const connector = await AppDataSource.getRepository(IngestionConnector).findOneBy({ id: connectorId });
  // Enqueued and then deleted, or disabled after the tick. Neither is a fault:
  // there is nothing to run and nothing to record.
  if (!connector) {
    console.warn(`[worker] ${RUN_JOB} job for unknown connector ${connectorId}`);
    return;
  }

  // The same run function the Admin trigger reaches through the queue — there is
  // no second implementation to drift.
  const run = await runConnector(connector, { fetchText: httpFetchText });
  console.log(
    run
      ? `[worker] ${connector.name} run ${run.id} ${run.status}: ${run.discovered} discovered, ${run.inserted} inserted`
      : `[worker] ${connector.name} is disabled — not run`,
  );
}
