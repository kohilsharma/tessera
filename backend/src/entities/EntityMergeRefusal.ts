import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { User } from "./User";
import type { PromotableKind } from "../graph/config";

// CONTEXT.md "Refused merge": an Admin's judgement that two similar names are not the
// same thing, remembered so no later pass proposes the pair again.
//
// Keyed on the *names*, not on Entity ids — the deliberate divergence from
// RejectedStoryAssignment, which keys on rows because a Story is durable. An Entity is
// a working-set row that can fall below the promotion floor, be demoted, and be
// promoted again next month under a fresh id; the judgement that `United States` and
// `United States Steel` are two things survives all of that, so it is stored where the
// Entities are not.
//
// The pair is unordered — refusing (A, B) refuses (B, A) — so it is stored ordered,
// `normalizedNameA < normalizedNameB` by CHECK, and one composite key is the whole
// check. Refusing the same pair twice is a no-op rather than a second row.
@Entity("entity_merge_refusals")
export class EntityMergeRefusal {
  @PrimaryColumn({ type: "varchar" })
  kind!: PromotableKind;

  // As on EntityAlias: a location's gazetteer id, '' for the kinds without one.
  @PrimaryColumn({ type: "text", default: "" })
  featureKey!: string;

  @PrimaryColumn({ type: "text" })
  normalizedNameA!: string;

  @PrimaryColumn({ type: "text" })
  normalizedNameB!: string;

  // Nullable with ON DELETE SET NULL, as for a rejected pairing: deleting the account
  // that refused a pair must not re-open it.
  @Column({ type: "uuid", nullable: true })
  refusedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "refusedByUserId" })
  refusedBy!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  refusedAt!: Date;
}
