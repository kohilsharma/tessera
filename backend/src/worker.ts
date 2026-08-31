import "reflect-metadata";
import { Worker } from "bullmq";
import { AppDataSource } from "./data-source";
import { runClusteringJob } from "./clustering/jobs";
import {
  CLUSTERING_QUEUE,
  CLUSTERING_TICK_JOB,
  closeClusteringQueue,
  clusteringQueue,
} from "./clustering/queue";
import { runIngestionJob } from "./ingestion/jobs";
import { INGESTION_QUEUE, TICK_JOB, closeIngestionQueue, ingestionQueue, redisUrl } from "./ingestion/queue";

// The ingestion worker: its own process, sharing this repo's DataSource and
// entities with the API, and run natively rather than in Compose (ADR-0015).
// `npm run worker` in development, `npm run start:worker` from dist/.
// From #49 it drains the clustering queue too — one process, two queues, because
// the two passes keep different clocks but there is no second thing to deploy.

// GDELT publishes a new GKG window every 15 minutes on the quarter hour
// (ADR-0018), so the tick sits on that boundary — six fields, so second 0. The
// tick is also what ages GKG rows out (ingestion/retention.ts).
// A tick whose fleet is still draining 15 minutes later has its re-enqueue
// swallowed by the per-connector job id, and the worker is not a 24/7 service
// either — so neither a missed tick nor a stopped worker loses a window: the GKG
// connector's cursor (#45) heals the gap on its next run, up to a two-hour cap.
const TICK_SCHEDULE = { pattern: "0 */15 * * * *" };

// ADR-0026: clustering is hourly. Five past, not on the hour: the quarter-hour tick
// above is already fanning the feed fleet out at :00, and a clustering pass reads
// what ingestion has just written.
const CLUSTERING_TICK_SCHEDULE = { pattern: "0 5 * * * *" };

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

  // Its own worker, so an hourly clustering pass is not queued behind a fleet of
  // feeds — and its own concurrency of 1, which with the constant job id is what
  // makes two concurrent clustering runs structurally impossible.
  await clusteringQueue().upsertJobScheduler(CLUSTERING_TICK_JOB, CLUSTERING_TICK_SCHEDULE, {
    name: CLUSTERING_TICK_JOB,
  });
  const clusteringWorker = new Worker(CLUSTERING_QUEUE, runClusteringJob, {
    connection: { url: redisUrl(), maxRetriesPerRequest: null },
    concurrency: CONCURRENCY,
  });
  clusteringWorker.on("failed", (job, err) => console.error(`[worker] job ${job?.name} ${job?.id} failed`, err));
  clusteringWorker.on("error", (err) => console.error("[worker] queue connection error", err));
  console.log(`[worker] draining "${CLUSTERING_QUEUE}", ticking on "${CLUSTERING_TICK_SCHEDULE.pattern}"`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} — finishing the current job`);
    await worker.close();
    await clusteringWorker.close();
    await closeIngestionQueue();
    await closeClusteringQueue();
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
