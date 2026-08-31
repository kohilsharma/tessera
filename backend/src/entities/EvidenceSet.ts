import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Story } from "./Story";

// CONTEXT.md "EvidenceSet": the frozen, immutable list of Article snapshots one
// generation was based on. Frozen means persisted before the model is called and
// never rewritten — a later edit to an Article changes what the *next* set holds,
// never what a past analysis rested on (ADR-0010 §16.3).
//
// Its own table rather than columns on the run, because the set is what a run is
// keyed by: ADR-0027 reuses a completed run when the same Story, Lens and prompt
// version meet the same evidence, and `contentHash` is how "the same evidence" is
// answered without comparing timestamps that miss an Article enriched in place.
@Entity("evidence_sets")
export class EvidenceSet {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Story)
  @JoinColumn({ name: "storyId" })
  story!: Story;

  @Column({ type: "uuid" })
  storyId!: string;

  // The composite hash over this set's rows — each row's evidence id and the hash
  // of the Article's full analysis text, in evidence-id order. Half of ADR-0027's
  // reuse key (the Lens and the prompt version are the other half, and they live
  // on the run).
  @Column({ type: "varchar" })
  contentHash!: string;

  @Column({ type: "integer" })
  articleCount!: number;

  // Counted at freeze time because it is a fact about this set, not about the
  // Story: the ≤2-per-publisher bound (ADR-0010 §16.2) is what makes it meaningful,
  // and #54's minimum-2 refusal and wire-copy collapse are what will read it.
  @Column({ type: "integer" })
  distinctPublisherCount!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
