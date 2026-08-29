import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

// CONTEXT.md "IngestionConnector": *how* Tessera discovers/receives data. A
// connector is not a Publisher — one GDELT connector spans many publishers.
// The kinds are ADR-0018's ingestion surfaces.
export const CONNECTOR_KINDS = ["gdelt_gkg", "gdelt_doc", "rss"] as const;
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
