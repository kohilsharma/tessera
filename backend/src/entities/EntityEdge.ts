import { Column, Entity as TypeOrmEntity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Article } from "./Article";
import { Entity } from "./Entity";

// CONTEXT.md "EntityEdge": two Entities named in the same Article. Co-occurrence
// only — never a typed relation (ADR-0019).
//
// One row per (pair, Article), not one row per pair carrying a list of Articles
// and a stored weight. That is what makes AGENTS.md's "every EntityEdge carries
// its source_article_id — uncited edges are bugs" true by construction rather
// than by a reconciliation job: retention deletes a GDELT Article every quarter
// hour, the citation goes with it, and the last citation going takes the edge.
// A weight is then a COUNT over these rows, which cannot disagree with them.
@TypeOrmEntity("entity_edges")
export class EntityEdge {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // Ordered by id, `entityAId < entityBId`, enforced by a CHECK: co-occurrence is
  // symmetric, so storing both directions would be storing the same fact twice.
  @ManyToOne(() => Entity)
  @JoinColumn({ name: "entityAId" })
  entityA!: Entity;

  @Column({ type: "uuid" })
  entityAId!: string;

  @ManyToOne(() => Entity)
  @JoinColumn({ name: "entityBId" })
  entityB!: Entity;

  @Column({ type: "uuid" })
  entityBId!: string;

  // The Article both were named in. The citation, and the reason this row exists.
  @ManyToOne(() => Article)
  @JoinColumn({ name: "articleId" })
  article!: Article;

  @Column({ type: "uuid" })
  articleId!: string;
}
