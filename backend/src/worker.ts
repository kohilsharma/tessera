import "reflect-metadata";
import { Worker, type Processor, type Queue } from "bullmq";
import { AppDataSource } from "./data-source";
import { runClusteringJob } from "./clustering/jobs";
import { CLUSTERING_QUEUE, CLUSTERING_TICK_JOB, closeClusteringQueue, clusteringQueue } from "./clustering/queue";
import { runGraphJob } from "./graph/jobs";
import { GRAPH_QUEUE, GRAPH_TICK_JOB, closeGraphQueue, graphQueue } from "./graph/queue";
import { runIngestionJob } from "./ingestion/jobs";
import { INGESTION_QUEUE, TICK_JOB, closeIngestionQueue, ingestionQueue, redisUrl } from "./ingestion/queue";
import { log } from "./lib/logger";

// The ingestion worker: its own process, sharing this repo's DataSource and
// entities with the API, and run natively rather than in Compose (ADR-0015).
// `npm run worker` in development, `npm run start:worker` from dist/.
// From #49 it drains the clustering queue too, and from #66 the graph queue — one
// process, three queues, because the passes keep different clocks but there is no
// second thing to deploy.

// One at a time, per queue. A GKG window is ~700 rows and holding the whole fleet
// behind it is the point: with a per-connector job id (queue.ts) this makes two
// concurrent runs of anything structurally impossible, rather than something the run
// function has to defend against.
// ponytail: the ceiling is throughput — a slow feed delays the rest of that tick.
// Raising concurrency is the upgrade, and it needs a per-connector lock in
// runConnector first.
const CONCURRENCY = 1;

// What a queue is to this process: a schedule to keep, a handler to run, and a
// connection to close. Three near-identical ten-line blocks were the alternative, and
// the third copy is where one of them quietly stops matching the others.
type Pipeline = {
  name: string;
  queue: () => Queue;
  tickJob: string;
  // Six cron fields, so the leading 0 is the second.
  pattern: string;
  handler: Processor;
  close: () => Promise<void>;
};

const PIPELINES: Pipeline[] = [
  {
    // GDELT publishes a new GKG window every 15 minutes on the quarter hour
    // (ADR-0018), so the tick sits on that boundary. The tick is also what ages GKG
    // rows out (ingestion/retention.ts).
    // A tick whose fleet is still draining 15 minutes later has its re-enqueue
    // swallowed by the per-connector job id, and the worker is not a 24/7 service
    // either — so neither a missed tick nor a stopped worker loses a window: the GKG
    // connector's cursor (#45) heals the gap on its next run, up to a two-hour cap.
    name: INGESTION_QUEUE,
    queue: ingestionQueue,
    tickJob: TICK_JOB,
    pattern: "0 */15 * * * *",
    handler: runIngestionJob,
    close: closeIngestionQueue,
  },
  {
    // ADR-0026: clustering is hourly. Five past, not on the hour: the quarter-hour
    // tick above is already fanning the feed fleet out at :00, and a clustering pass
    // reads what ingestion has just written.
    name: CLUSTERING_QUEUE,
    queue: clusteringQueue,
    tickJob: CLUSTERING_TICK_JOB,
    pattern: "0 5 * * * *",
    handler: runClusteringJob,
    close: closeClusteringQueue,
  },
  {
    // Hourly too, at twenty past: clear of the quarter-hour ingestion ticks on either
    // side of it, and after clustering, since both read what ingestion wrote and only
    // one of them should be holding the annotation table at a time.
    name: GRAPH_QUEUE,
    queue: graphQueue,
    tickJob: GRAPH_TICK_JOB,
    pattern: "0 20 * * * *",
    handler: runGraphJob,
    close: closeGraphQueue,
  },
];

async function main(): Promise<void> {
  await AppDataSource.initialize();

  const workers: Worker[] = [];
  for (const pipeline of PIPELINES) {
    // Upsert, not add: restarting the worker must not leave two schedulers ticking.
    await pipeline
      .queue()
      .upsertJobScheduler(pipeline.tickJob, { pattern: pipeline.pattern }, { name: pipeline.tickJob });

    // A worker per queue, so an hourly pass is never queued behind a fleet of feeds —
    // and a concurrency of 1 each, which with the constant job ids is what makes two
    // concurrent runs of the same pass structurally impossible.
    const worker = new Worker(pipeline.name, async (job) => {
      const startedAt = process.hrtime.bigint();
      try {
        const result = await pipeline.handler(job);
        log("info", "job.completed", {
          jobId: job.id,
          jobName: job.name,
          connectorId: job.data?.connectorId,
          runId: job.data?.runId,
          storyId: job.data?.storyId,
          generationRunId: job.data?.generationRunId,
          durationMs: Math.round((Number(process.hrtime.bigint() - startedAt) / 1e6) * 100) / 100,
          resultStatus: "completed",
        });
        return result;
      } catch (error) {
        log("error", "job.failed", {
          jobId: job.id,
          jobName: job.name,
          connectorId: job.data?.connectorId,
          runId: job.data?.runId,
          storyId: job.data?.storyId,
          generationRunId: job.data?.generationRunId,
          durationMs: Math.round((Number(process.hrtime.bigint() - startedAt) / 1e6) * 100) / 100,
          resultStatus: "failed",
          errorCode: "job_failed",
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }, {
      // Unlike the queues' connections, a worker waits indefinitely rather than
      // failing a command: a Redis blip should pause draining, not kill the process.
      connection: { url: redisUrl(), maxRetriesPerRequest: null },
      concurrency: CONCURRENCY,
    });
    // A job that throws is an infrastructure fault: a run that merely fails is a
    // persisted run row with status `failed`, which the Admin console already states.
    // Without a listener, a dropped Redis connection is an unhandled 'error' event,
    // which takes the process down — the likeliest thing to happen to a demo.
    worker.on("error", (err) => log("error", "job.queue_error", { jobId: undefined, errorCode: "queue_connection", message: err.message }));
    workers.push(worker);
    log("info", "worker.started", { jobName: pipeline.name, schedule: pipeline.pattern });
  }

  const shutdown = async (signal: string): Promise<void> => {
    log("info", "worker.shutdown", { signal });
    for (const worker of workers) await worker.close();
    for (const pipeline of PIPELINES) await pipeline.close();
    await AppDataSource.destroy();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log("error", "worker.start_failed", { errorCode: "worker_start_failed", message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
