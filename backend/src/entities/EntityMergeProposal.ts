import { Column, Entity as TypeOrmEntity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Entity } from "./Entity";

// A candidate merge in the band beneath the automatic bar, held for an Admin. It
// changes nothing on its own: both Entities stand, both keep their edges, and the graph
// reads exactly as it would without the proposal — v3 §18.5's rule is that a wrong
// merge is more harmful than an unresolved duplicate, so the doubt waits here.
//
// Derived state, rebuilt whole by each pass the way the edges are, which is why it
// carries no timestamp: a pair re-proposed every hour has no meaningful age. Both
// foreign keys cascade, so a demoted Entity takes its open proposals with it.
@TypeOrmEntity("entity_merge_proposals")
export class EntityMergeProposal {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // Orientation is fixed here, at proposal time, so the queue and the accept agree on
  // which name remains: the better-attested side survives, ties by normalized name.
  @Column({ type: "uuid" })
  survivorEntityId!: string;

  @ManyToOne(() => Entity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "survivorEntityId" })
  survivor!: Entity;

  @Column({ type: "uuid" })
  mergedEntityId!: string;

  @ManyToOne(() => Entity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "mergedEntityId" })
  merged!: Entity;

  // What pg_trgm measured between the two normalized names. Shown to the reviewer, and
  // the sort key of the queue, so the closest calls are read first.
  @Column({ type: "real" })
  similarity!: number;

  // The distinct-Article counts the pass counted, stored rather than recounted on read:
  // they are the evidence the orientation was chosen by, and an Admin deciding hours
  // later should see the numbers behind the proposal, not fresher ones.
  @Column({ type: "integer" })
  survivorArticleCount!: number;

  @Column({ type: "integer" })
  mergedArticleCount!: number;
}
