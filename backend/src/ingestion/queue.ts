import { Queue } from "bullmq";

// ADR-0005's queue, and after #42 the *only* path a connector runs by: the Admin
// trigger and the worker's 15-minute scheduler both add jobs here, and the worker
// is the only thing that executes them. What is demoed is what runs.
export const INGESTION_QUEUE = "ingestion";

// Two job kinds on one queue. The tick is the scheduler's heartbeat and only fans
// out; a run job is one connector's invocation. Separating them keeps the tick
// cheap and makes the queue itself the record of pending work.
export const TICK_JOB = "tick";
export const RUN_JOB = "run";

export type RunJobData = { connectorId: string };

// bullmq loads its Redis driver from the `connection` option, so a URL is all
// either side passes — no client of our own to keep alive. Read per call rather
// than at module load: the API imports this module at boot and a demo machine with
// no Redis should fail when someone triggers a run, not refuse to serve anything.
export function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set — copy backend/.env.example to backend/.env (see SETUP.md).");
  return url;
}

let queue: Queue | null = null;

// No `maxRetriesPerRequest: null` here, unlike the worker's connection: a command
// that waits forever would hold the Admin's request open forever. An enqueue that
// cannot reach Redis should fail the request.
export function ingestionQueue(): Queue {
  queue ??= new Queue(INGESTION_QUEUE, { connection: { url: redisUrl() } });
  return queue;
}

export async function closeIngestionQueue(): Promise<void> {
  await queue?.close();
  queue = null;
}

// The connector's own id *is* the job id, which is what keeps a trigger landing
// mid-run from becoming a second run: bullmq will not add a job whose id already
// exists, so while a connector's run is queued or in flight, enqueueing it again
// is a no-op. Bare, with no `run:` prefix — bullmq rejects a custom id containing
// a colon, and a connector uuid is unambiguous on a queue where it is the only
// custom id.
// Both removals are on, so the id frees the moment the run finishes and the next
// tick can schedule it again. A failed *job* is an infrastructure fault (Redis or
// Postgres unreachable at dequeue) and is logged by the worker; the next tick is
// its retry. A failed *run* is an IngestionRun row with status `failed`, which is
// the record an operator reads (ADR-0024).
export async function enqueueConnectorRun(connectorId: string): Promise<void> {
  await ingestionQueue().add(
    RUN_JOB,
    { connectorId } satisfies RunJobData,
    { jobId: connectorId, removeOnComplete: true, removeOnFail: true },
  );
}
