import { GRAPH_RUN_JOB, GRAPH_TICK_JOB, enqueueEntityResolutionRun } from "./queue";
import { runEntityResolution } from "./runEntityResolution";

// What the worker does with a graph job, kept out of src/worker.ts for the reason the
// other two job modules are: the entrypoint owns the process, this owns the behaviour,
// and tests can drive the behaviour without one.
export async function runGraphJob(job: { name: string }): Promise<void> {
  if (job.name === GRAPH_TICK_JOB) {
    await enqueueEntityResolutionRun();
    return;
  }
  if (job.name !== GRAPH_RUN_JOB) throw new Error(`Unknown graph job "${job.name}"`);

  const run = await runEntityResolution();
  console.log(
    `[worker] entity resolution run ${run.id} ${run.status}: read ${run.annotationsRead} annotations ` +
      `across ${run.articlesRead} Article(s), considered ${run.considered} name(s), ` +
      `promoted ${run.promoted}, ${run.belowFloor} below the floor, demoted ${run.demoted}, ` +
      `built ${run.edgesBuilt} edge(s)`,
  );
}
