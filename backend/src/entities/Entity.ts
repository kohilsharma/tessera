import { Column, Entity as TypeOrmEntity, PrimaryGeneratedColumn } from "typeorm";
import type { PromotableKind } from "../graph/config";

// CONTEXT.md "Entity": one canonical person, organization or place the graph has a
// node for, resolved from the GKG Annotations staged against Articles. A Theme is
// never one (ADR-0028) — see `PROMOTABLE_KINDS` in ../graph/config.
//
// The class keeps the vocabulary word and TypeORM's decorator is renamed, rather
// than the other way round: `EntityRecord` or `GraphNode` would be a second name
// for a term CONTEXT.md already fixes.
@TypeOrmEntity("entities")
export class Entity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // The kinds that promote, and only those: `PromotableKind` is narrowed from
  // GkgAnnotationKind (../graph/config), so a Theme node does not compile. The
  // migration's CHECK says the same thing to anything reaching the table directly.
  @Column({ type: "varchar" })
  kind!: PromotableKind;

  // The most frequent surface form this Entity's occurrences were reported in,
  // ties broken lexicographically, so the displayed name is a real name GDELT
  // used and not a lowercased fold of one.
  @Column({ type: "text" })
  canonicalName!: string;

  // What identity is decided on: case, punctuation and whitespace folded. Written
  // by the pass's own SQL fold (see ../graph/runEntityResolution) so a name never
  // normalizes one way on insert and another on lookup.
  @Column({ type: "text" })
  normalizedName!: string;

  // GKG's own gazetteer id, non-null for `location` only. Part of a location's
  // identity, because two places genuinely share a name — `Springfield` in
  // Illinois and `Springfield` in Missouri are two nodes, not one merged place.
  //
  // ponytail: FeatureID alone, no coordinates or country. The Annotation rows
  // still carry them; copy them up when a map view needs to place a node.
  @Column({ type: "varchar", nullable: true })
  featureId!: string | null;
}
