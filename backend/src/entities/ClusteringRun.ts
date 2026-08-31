import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

// CONTEXT.md "Clustering Run": one invocation of the clustering job, and the only
// record of what that invocation did. The counterpart of an IngestionRun, and
// persisted in Postgres for the same reason — the Admin console reads history from
// the database, never from the queue, so it renders with the worker stopped
// (ADR-0026).
//
// No `connectorId` counterpart: clustering is one job over the whole corpus rather
// than one invocation per source, so a run has nothing to belong to.
export const CLUSTERING_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type ClusteringRunStatus = (typeof CLUSTERING_RUN_STATUSES)[number];

@Entity("clustering_runs")
export class ClusteringRun {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // Written `running` before the first embedding request and updated to a terminal
  // status at the end, exactly as an IngestionRun is: a row that exists before the
  // work does is what makes a run in flight visible while the worker is still
  // working through it.
  @Column({ type: "varchar" })
  status!: ClusteringRunStatus;

  @Column({ type: "timestamptz" })
  startedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  completedAt!: Date | null;

  // How many eligible Articles this run wrote a vector for. Its own count rather
  // than part of the ledger below: embedding is the run's input step (ADR-0026),
  // and an Article embedded this run and assigned this run is one of each.
  @Column({ type: "integer", default: 0 })
  embedded!: number;

  // The ledger. Every Article this run considered ends in exactly one of the three
  // counters below, so `assigned + seeded + unclustered = considered` for every
  // persisted run — including a failed one, where whatever the run did not reach
  // is counted as unclustered, because that is where it was left.
  //
  // CONTEXT.md's entry also names a held-for-review count. There is no band beneath
  // the threshold yet — every assignment this job makes is auto-accepted — so that
  // counter lands with #50, alongside the pending state it counts.
  @Column({ type: "integer", default: 0 })
  considered!: number;

  @Column({ type: "integer", default: 0 })
  assigned!: number;

  // Articles placed into Stories this run created, as against joining one that
  // already existed. Two counters rather than one because they answer different
  // questions about a corpus: whether clustering is tracking events it already
  // knows, or finding new ones.
  @Column({ type: "integer", default: 0 })
  seeded!: number;

  @Column({ type: "integer", default: 0 })
  unclustered!: number;

  // Counts Stories, not Articles, so it is deliberately outside the ledger sum
  // above: one created Story accounts for two or more `seeded` Articles
  // (ADR-0026 — no singleton Stories).
  @Column({ type: "integer", default: 0 })
  storiesCreated!: number;

  // A failed run has to be diagnosable without reading server logs — the same
  // requirement as IngestionRun's, and the same one field the Admin console
  // states a run's reasons on.
  @Column({ type: "text", nullable: true })
  errorSummary!: string | null;
}
