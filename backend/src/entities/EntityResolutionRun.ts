import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

// CONTEXT.md "Entity Resolution Run": one invocation of the resolution pass, and the
// only record of what that invocation did. Persisted in Postgres for the reason the
// other two run tables are — the Admin console reads history from the database, never
// from the queue, so it renders with the worker stopped.
export const ENTITY_RESOLUTION_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type EntityResolutionRunStatus = (typeof ENTITY_RESOLUTION_RUN_STATUSES)[number];

@Entity("entity_resolution_runs")
export class EntityResolutionRun {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  status!: EntityResolutionRunStatus;

  @Column({ type: "timestamptz" })
  startedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  completedAt!: Date | null;

  // What the pass read, before it decided anything: promotable occurrences, and the
  // Articles carrying them. Input counters rather than ledger entries — a name is
  // considered once however many occurrences it was reported in, which is the whole
  // point of the floor counting distinct Articles.
  @Column({ type: "integer", default: 0 })
  annotationsRead!: number;

  @Column({ type: "integer", default: 0 })
  articlesRead!: number;

  // The ledger, counted in candidate names — a normalized surface name, plus its
  // FeatureID where it is a location. Every candidate this run considered ends in
  // exactly one of the two counters below, so `promoted + belowFloor = considered`
  // for every persisted run.
  @Column({ type: "integer", default: 0 })
  considered!: number;

  @Column({ type: "integer", default: 0 })
  promoted!: number;

  @Column({ type: "integer", default: 0 })
  belowFloor!: number;

  // Entities deleted because the annotations that promoted them have aged out of the
  // retained window. Outside the ledger sum: a demoted Entity is one the *previous*
  // pass promoted, so counting it among this pass's candidates would be counting a
  // name that is no longer there.
  @Column({ type: "integer", default: 0 })
  demoted!: number;

  // Distinct pairs in the rebuilt graph — edges as a reader counts them, not the
  // citation rows behind them. Outside the sum too: it counts pairs, not names.
  @Column({ type: "integer", default: 0 })
  edgesBuilt!: number;

  @Column({ type: "text", nullable: true })
  errorSummary!: string | null;
}
