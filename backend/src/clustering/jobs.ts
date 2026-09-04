import { createEmbeddingProvider } from "../embeddings";
import { createSynthesisProvider, type SynthesisProvider } from "../synthesis";
import { CLUSTERING_RUN_JOB, CLUSTERING_TICK_JOB, enqueueClusteringRun } from "./queue";
import { runClustering } from "./runClustering";

// Naming is the one clustering step allowed to fail quietly (naming.ts), but
// *resolving* its provider sat outside that promise: an incomplete SYNTHESIS_*
// block threw before the run began and failed an otherwise deterministic pass.
// Deferring construction into the call puts a configuration error on the same
// path as an unanswerable provider, so the Story keeps its medoid title and the
// run still records what it clustered.
const deferredNamer: SynthesisProvider = {
  complete: (request) => createSynthesisProvider().complete(request),
};

// What the worker does with a clustering job, kept out of src/worker.ts for the
// same reason ingestion/jobs.ts is: the entrypoint owns the process, this owns the
// behaviour, and tests can drive the behaviour without one.
export async function runClusteringJob(job: { name: string }): Promise<void> {
  if (job.name === CLUSTERING_TICK_JOB) {
    await enqueueClusteringRun();
    return;
  }
  if (job.name !== CLUSTERING_RUN_JOB) throw new Error(`Unknown clustering job "${job.name}"`);

  // Neither provider is held: a key added to .env takes effect on the next run
  // (the next naming call, for the namer above) without restarting the worker, and
  // ADR-0023's Mock fallback keeps an offline clone running the same code path.
  const run = await runClustering({ embedder: createEmbeddingProvider(), namer: deferredNamer });
}
