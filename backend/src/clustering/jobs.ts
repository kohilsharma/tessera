import { createEmbeddingProvider } from "../embeddings";
import { CLUSTERING_RUN_JOB, CLUSTERING_TICK_JOB, enqueueClusteringRun } from "./queue";
import { runClustering } from "./runClustering";

// What the worker does with a clustering job, kept out of src/worker.ts for the
// same reason ingestion/jobs.ts is: the entrypoint owns the process, this owns the
// behaviour, and tests can drive the behaviour without one.
export async function runClusteringJob(job: { name: string }): Promise<void> {
  if (job.name === CLUSTERING_TICK_JOB) {
    await enqueueClusteringRun();
    return;
  }
  if (job.name !== CLUSTERING_RUN_JOB) throw new Error(`Unknown clustering job "${job.name}"`);

  // The provider is resolved per run rather than held: a key added to .env takes
  // effect on the next run without restarting the worker, and ADR-0023's Mock
  // fallback keeps an offline clone running the same code path.
  const run = await runClustering({ embedder: createEmbeddingProvider() });
  console.log(
    `[worker] clustering run ${run.id} ${run.status}: embedded ${run.embedded}, considered ${run.considered}, ` +
      `assigned ${run.assigned}, seeded ${run.seeded} into ${run.storiesCreated} new Story(s), ` +
      `${run.unclustered} left unclustered`,
  );
}
