import { Queue } from "bullmq";
import { redisUrl } from "../ingestion/queue";

// The third repeatable job, and the only path a resolution pass happens by — the
// hourly scheduler and the Admin trigger both add jobs here, and the worker is the
// only thing that executes them. Its own queue for the reason clustering has one: a
// pass over the whole annotation set should not queue behind a fleet of feeds, or
// behind an embedding pass, neither of which it shares anything with.
export const GRAPH_QUEUE = "graph";

// Two job kinds on one queue, as both older queues have: the tick only enqueues, so
// that a scheduled pass carries the same custom job id an Admin trigger uses.
export const GRAPH_TICK_JOB = "tick";
export const GRAPH_RUN_JOB = "run";

// One pass over everything, so there is only ever one run to queue. bullmq will not
// add a job whose id already exists, which is what makes a trigger landing mid-pass a
// no-op rather than a second pass rebuilding the graph underneath the first.
const GRAPH_RUN_JOB_ID = "graph-run";

let queue: Queue | null = null;

export function graphQueue(): Queue {
  // No `maxRetriesPerRequest: null`, matching the other two: an enqueue that cannot
  // reach Redis should fail the Admin's request rather than hold it open forever.
  queue ??= new Queue(GRAPH_QUEUE, { connection: { url: redisUrl() } });
  return queue;
}

export async function closeGraphQueue(): Promise<void> {
  await queue?.close();
  queue = null;
}

export async function enqueueEntityResolutionRun(): Promise<void> {
  await graphQueue().add(GRAPH_RUN_JOB, {}, { jobId: GRAPH_RUN_JOB_ID, removeOnComplete: true, removeOnFail: true });
}
