import { Queue } from "bullmq";
import { redisUrl } from "../ingestion/queue";

// ADR-0026: clustering is a second repeatable job alongside ingestion's, and the
// only path a run happens by — the hourly scheduler and the Admin trigger both add
// jobs here, and the worker is the only thing that executes them. Its own queue
// rather than a second job name on the ingestion queue, so an hourly pass is not
// held behind a 15-minute fleet of feeds it has nothing to do with.
//
// `redisUrl` is ingestion's, read per call for the reason stated there: a demo
// machine with no Redis should fail when someone triggers a run, not refuse to
// serve anything.
export const CLUSTERING_QUEUE = "clustering";

// Two job kinds on one queue, exactly as ingestion has: the tick only enqueues,
// and a run is one invocation of the job. The indirection is what gives a
// scheduled run the same custom job id an Admin trigger uses — a scheduler's own
// jobs carry generated ids, so without it a trigger landing on the hour would
// become a second run of the same pass.
export const CLUSTERING_TICK_JOB = "tick";
export const CLUSTERING_RUN_JOB = "run";

// The whole corpus is the subject, so there is only ever one run to queue, and its
// job id is a constant for the same reason a connector's id is ingestion's: bullmq
// will not add a job whose id already exists, so while a run is queued or in
// flight, enqueueing another is a no-op.
const CLUSTERING_RUN_JOB_ID = "clustering-run";

let queue: Queue | null = null;

export function clusteringQueue(): Queue {
  // No `maxRetriesPerRequest: null`, matching ingestion's queue connection: an
  // enqueue that cannot reach Redis should fail the Admin's request rather than
  // hold it open forever.
  queue ??= new Queue(CLUSTERING_QUEUE, { connection: { url: redisUrl() } });
  return queue;
}

export async function closeClusteringQueue(): Promise<void> {
  await queue?.close();
  queue = null;
}

export async function enqueueClusteringRun(): Promise<void> {
  await clusteringQueue().add(
    CLUSTERING_RUN_JOB,
    {},
    { jobId: CLUSTERING_RUN_JOB_ID, removeOnComplete: true, removeOnFail: true },
  );
}
