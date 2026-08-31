import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

// CONTEXT.md "IngestionConnector": *how* Tessera discovers/receives data. A
// connector is not a Publisher — one GDELT connector spans many publishers.
// The kinds are ADR-0018's ingestion surfaces. `readability` is the fourth (#47),
// and the one that discovers nothing: it re-reads Articles the RSS connectors
// already stored, so its endpoint names the pass rather than an address (see
// seedData/corpus.ts). It is a connector because everything an operator needs
// around it — enable/disable, an on-demand Run, one IngestionRun per invocation
// with its own ledger — already exists for connectors and for nothing else.
export const CONNECTOR_KINDS = ["gdelt_gkg", "gdelt_doc", "rss", "readability"] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

// Seed-only in Phase 1 (ADR-0022): nothing reads `endpoint` until ingestion
// lands in Phase 2 — the Admin dashboard only inspects these rows.
@Entity("ingestion_connectors")
export class IngestionConnector {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", unique: true })
  name!: string;

  @Column({ type: "varchar" })
  kind!: ConnectorKind;

  @Column({ type: "varchar" })
  endpoint!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
