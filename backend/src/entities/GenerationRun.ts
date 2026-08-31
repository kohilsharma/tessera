import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { EvidenceSet } from "./EvidenceSet";
import { Story } from "./Story";
import { User } from "./User";

// CONTEXT.md "Lens": the single role-specific claim type one generation carries.
// Exactly one per run (ADR-0010), derived from the caller's role — an Admin is the
// only caller who names it.
export const GENERATION_LENSES = ["student_context", "investor_implication"] as const;
export type GenerationLens = (typeof GENERATION_LENSES)[number];

// Two statuses, not v3 §9.5's nine. Generation is synchronous (ADR-0027), so the
// row is written once, at the end, and every intermediate state v3 lists —
// queued, selecting_evidence, generating, validating, persisting — is a phase of
// one HTTP request that no reader can observe. `superseded` is not needed either:
// reuse looks a completed run up by its evidence hash, so an older run is simply
// not found rather than marked.
export const GENERATION_RUN_STATUSES = ["completed", "failed"] as const;
export type GenerationRunStatus = (typeof GENERATION_RUN_STATUSES)[number];

// Why a run failed, in a vocabulary a reader can be shown. The detail goes in
// `failureMessage`, which is for an Admin reading the row — a provider's error
// text can name hosts and keys, so it is never part of a response.
export const GENERATION_FAILURE_CODES = [
  // The provider did not answer at all: no key, a timeout, a rate limit.
  "provider_error",
  // It answered with something that is not JSON.
  "unparseable_output",
  // It answered with JSON that is not the claim contract.
  "schema_violation",
  // The contract held but a claim cited nothing, or cited an evidence id that is
  // not in the frozen set. This is ADR-0002's invariant refusing to be displayed.
  "invalid_citations",
  // An Article's analysis text changed between freezing and persisting, so the
  // claims describe text this run no longer holds (v3 §16.5).
  "content_changed",
] as const;
export type GenerationFailureCode = (typeof GENERATION_FAILURE_CODES)[number];

// What validating one answer measured. Persisted per run because it is the
// generation pass-rate the Phase-5 eval harness wants (ADR-0027), collected from
// day one as a side effect of enforcing the invariant.
export type GenerationValidationResult = {
  claimsReturned: number;
  claimsAccepted: number;
  claimsRejected: number;
  // Evidence ids the model cited that were never in the frozen set — the direct
  // measure of "how often does it cite evidence that does not exist".
  unknownEvidenceIds: string[];
  issues: { claimIndex: number; code: string; detail?: string }[];
};

// CONTEXT.md "GenerationRun": one attempt to produce analysis from an EvidenceSet
// under one Lens, recording the prompt version and the provider's raw answer so a
// past analysis is explicable after the prompt has moved on.
//
// Belongs to the Story, not to a reader or a Brief (ADR-0027): synthesis is shared
// and paid for once. #55 is what adds the Brief's nullable reference to a run.
@Entity("generation_runs")
export class GenerationRun {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Story)
  @JoinColumn({ name: "storyId" })
  story!: Story;

  @Column({ type: "uuid" })
  storyId!: string;

  @ManyToOne(() => EvidenceSet)
  @JoinColumn({ name: "evidenceSetId" })
  evidenceSet!: EvidenceSet;

  @Column({ type: "uuid" })
  evidenceSetId!: string;

  @Column({ type: "varchar" })
  lens!: GenerationLens;

  // ADR-0027: a versioned code constant today, an Admin-tuned PromptTemplate later
  // in the phase. Recorded on every run either way, so bumping it invalidates every
  // cached analysis by design and no history is lost when the table arrives.
  @Column({ type: "varchar" })
  promptVersion!: string;

  @Column({ type: "varchar" })
  status!: GenerationRunStatus;

  // The provider origin that received evidence text, kept separate from the model
  // because model ids are not globally unique.
  @Column({ type: "varchar" })
  provider!: string;

  @Column({ type: "varchar" })
  model!: string;

  // Nullable for the same reason Article.discoveredByConnectorId is: a seeded or
  // scripted run has no person behind it, and a deleted account must not take an
  // analysis other readers share with it.
  @ManyToOne(() => User)
  @JoinColumn({ name: "triggeredByUserId" })
  triggeredByUser!: User | null;

  @Column({ type: "uuid", nullable: true })
  triggeredByUserId!: string | null;

  // `text`, not v3's JSONB: unparseable output is exactly the case an Admin needs
  // to read, and a JSONB column cannot hold it. Null when the provider never
  // answered.
  @Column({ type: "text", nullable: true })
  rawResponse!: string | null;

  @Column({ type: "jsonb", nullable: true })
  validationResult!: GenerationValidationResult | null;

  @Column({ type: "varchar", nullable: true })
  failureCode!: GenerationFailureCode | null;

  @Column({ type: "text", nullable: true })
  failureMessage!: string | null;

  @Column({ type: "timestamptz" })
  startedAt!: Date;

  @Column({ type: "timestamptz" })
  completedAt!: Date;
}
