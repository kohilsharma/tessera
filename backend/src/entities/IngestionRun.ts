import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { IngestionConnector } from "./IngestionConnector";

// CONTEXT.md "IngestionRun": one invocation of one connector, and the only
// record of what that invocation did. Persisted in Postgres and read back from
// Postgres — never from the queue — so the Admin ingestion view renders with the
// worker down (ADR-0024).
export const INGESTION_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

@Entity("ingestion_runs")
export class IngestionRun {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => IngestionConnector)
  @JoinColumn({ name: "connectorId" })
  connector!: IngestionConnector;

  @Column({ type: "uuid" })
  connectorId!: string;

  // `running` is written before the first fetch and updated to a terminal status
  // at the end — a row that exists before the work does, which is what makes a
  // run in flight visible on the Admin console while the worker (#42) is still
  // working through it.
  @Column({ type: "varchar" })
  status!: IngestionRunStatus;

  @Column({ type: "timestamptz" })
  startedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  completedAt!: Date | null;

  // Every item a connector discovers ends in exactly one of the five counters
  // below, so they sum to `discovered` for every persisted run. If the run itself
  // fails part-way, anything it did not reach is classified as failed.
  //
  // ADR-0024 §5 calls these `insertedCount` / `enrichedCount` / `duplicateCount`;
  // the suffix is dropped because every column on this row is a count.
  @Column({ type: "integer", default: 0 })
  discovered!: number;

  @Column({ type: "integer", default: 0 })
  inserted!: number;

  // CONTEXT.md "Enrichment": an item Tessera already holds at the same canonical
  // URL that had something to contribute (text further up the ladder, or — from
  // #43 — GKG Annotations). A same-URL sighting that contributes nothing is a
  // Duplicate instead, so re-running an unchanged feed enriches nothing.
  @Column({ type: "integer", default: 0 })
  enriched!: number;

  @Column({ type: "integer", default: 0 })
  duplicate!: number;

  // The Terms Class gate (#40). Stays 0 until that lands; the counter exists now
  // because the Admin surface's ledger shape is what #39 is proving.
  @Column({ type: "integer", default: 0 })
  rejectedByPolicy!: number;

  @Column({ type: "integer", default: 0 })
  failed!: number;

  // Story 10: a failed run has to be diagnosable without reading server logs.
  @Column({ type: "text", nullable: true })
  errorSummary!: string | null;

  // Where the connector got to, in whatever terms its source keeps time: an RSS
  // feed's lastBuildDate now, a GKG window filename from #45.
  @Column({ type: "varchar", nullable: true })
  cursor!: string | null;
}
