import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";
import type { PromotableKind } from "../graph/config";

// A name that has been merged away, and the name it now folds into. Read by the
// pass's own fold (../graph/runEntityResolution), which is what makes a merge last:
// without it the merged name is re-promoted within the hour, because every pass
// re-inserts each folded name it still finds above the promotion floor, so deleting
// the merged Entity is not on its own a decision the pass can see.
//
// Keyed on the normalized name for the same reason a refusal is (see
// EntityMergeRefusal): an Entity is a working-set row, the judgement about the names
// is not.
//
// The invariant every writer keeps: `targetNormalizedName` is itself never aliased.
// Merging B into C repoints an existing A -> B at C, so one lookup resolves a name
// however many times it has moved, and the fold stays a single LEFT JOIN.
@Entity("entity_aliases")
export class EntityAlias {
  @PrimaryColumn({ type: "varchar" })
  kind!: PromotableKind;

  @PrimaryColumn({ type: "text" })
  normalizedName!: string;

  // A location's gazetteer id, or '' for the kinds that have none — the same
  // COALESCE the identity index applies, stored rather than expressed because this
  // column is joined against, not inferred on. An alias must not leak across
  // FeatureIDs: two Springfields keep their own decisions.
  @PrimaryColumn({ type: "text", default: "" })
  featureKey!: string;

  @Column({ type: "text" })
  targetNormalizedName!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
