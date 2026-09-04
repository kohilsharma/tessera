import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { AnalysisTextMode } from "./Article";
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

  @ManyToOne(() => Story, { nullable: true })
  @JoinColumn({ name: "storyId" })
  story!: Story | null;

  @Column({ type: "uuid" })
  storyId!: string | null;

  // The composite hash over this set's rows — each row's evidence id and the hash
  // of the Article's full analysis text, in evidence-id order. Half of ADR-0027's
  // reuse key (the Lens and the prompt version are the other half, and they live
  // on the run).
  @Column({ type: "varchar" })
  contentHash!: string;

  @Column({ type: "integer" })
  articleCount!: number;

  // Counted at freeze time because it is a fact about this set, not about the
  // Story: the ≤2-per-publisher bound (ADR-0010 §16.2) and #54's wire-copy collapse
  // are what make it meaningful, and the minimum-2 refusal is what reads it.
  @Column({ type: "integer" })
  distinctPublisherCount!: number;

  // ADR-0027: the weakest Analysis Text Mode among this set's members, which is what
  // decides whether the prompt carries v3 §16.6's constrained wording and whether an
  // omission claim may stand at all (#54). Recorded on the set rather than derived at
  // read time because it is a fact about what was analysed, and the members' modes
  // move up underneath it.
  //
  // Nullable for the same reason the provenance snapshots are: sets frozen before #54
  // never recorded one, and inventing it from today's Articles would be inventing
  // history. Every set frozen from now on carries it.
  @Column({ type: "varchar", nullable: true })
  dataMode!: AnalysisTextMode | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
