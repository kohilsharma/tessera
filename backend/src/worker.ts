import "reflect-metadata";
import { Worker } from "bullmq";
import { AppDataSource } from "./data-source";
import { runIngestionJob } from "./ingestion/jobs";
import { INGESTION_QUEUE, TICK_JOB, closeIngestionQueue, ingestionQueue, redisUrl } from "./ingestion/queue";

// The ingestion worker: its own process, sharing this repo's DataSource and
// entities with the API, and run natively rather than in Compose (ADR-0015).
// `npm run worker` in development, `npm run start:worker` from dist/.

// GDELT publishes a new GKG window every 15 minutes on the quarter hour
// (ADR-0018), so the tick sits on that boundary — six fields, so second 0.
// ponytail: a tick whose fleet is still draining 15 minutes later has its
// re-enqueue swallowed by the per-connector job id, and GKG keeps no cursor yet,
// so that window is skipped rather than deferred. Bounded by the fetch timeouts
// (a full fleet is minutes, not a quarter hour) and #45's cursor is the fix.
const TICK_SCHEDULE = { pattern: "0 */15 * * * *" };

// One at a time. A GKG window is ~700 rows and holding the whole fleet behind it
// is the point: with a per-connector job id (queue.ts) this makes two concurrent
// runs of anything structurally impossible, rather than something the run function
// has to defend against.
// ponytail: the ceiling is throughput — a slow feed delays the rest of that tick.
// Raising concurrency is the upgrade, and it needs a per-connector lock in
// runConnector first.
const CONCURRENCY = 1;

async function main(): Promise<void> {
  await AppDataSource.initialize();

  // Upsert, not add: restarting the worker must not leave two schedulers ticking.
  await ingestionQueue().upsertJobScheduler(TICK_JOB, TICK_SCHEDULE, { name: TICK_JOB });

  const worker = new Worker(INGESTION_QUEUE, runIngestionJob, {
    // Unlike the queue's connection, the worker waits indefinitely rather than
    // failing a command: a Redis blip should pause draining, not kill the process.
    connection: { url: redisUrl(), maxRetriesPerRequest: null },
    concurrency: CONCURRENCY,
  });
  // A job that throws is an infrastructure fault: a run that merely fails is a
  // persisted IngestionRun with status `failed` (ADR-0024), which the Admin
  // console already states.
  worker.on("failed", (job, err) => console.error(`[worker] job ${job?.name} ${job?.id} failed`, err));
  // Without a listener, a dropped Redis connection is an unhandled 'error' event,
  // which takes the process down — the likeliest thing to happen to a demo.
  worker.on("error", (err) => console.error("[worker] queue connection error", err));
  console.log(`[worker] draining "${INGESTION_QUEUE}", ticking on "${TICK_SCHEDULE.pattern}"`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} — finishing the current job`);
    await worker.close();
    await closeIngestionQueue();
    await AppDataSource.destroy();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start the ingestion worker", err);
  process.exit(1);
});
