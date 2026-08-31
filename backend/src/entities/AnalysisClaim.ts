import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { GENERATION_LENSES, GenerationRun, type GenerationLens } from "./GenerationRun";

// ADR-0010's reduced contract: three core types plus the run's one Lens. v3 §9.6's
// other four (coverage_difference, unresolved_question, caveat, timeline) are
// deliberately absent — every extra type is validation surface and one more way a
// cheap model answers off-contract, and the citation invariant is as provable with
// three as with eight. Adding one later is a value in this list, not a migration.
export const CORE_CLAIM_TYPES = ["consensus", "source_specific", "contradiction"] as const;
export type CoreClaimType = (typeof CORE_CLAIM_TYPES)[number];

export const CLAIM_TYPES = [...CORE_CLAIM_TYPES, ...GENERATION_LENSES] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

// What a run under one Lens may return: the three core types and *that* Lens only.
// The other Lens is off-contract, not a claim to drop — a run carries exactly one
// (ADR-0010).
export function claimTypesFor(lens: GenerationLens): ClaimType[] {
  return [...CORE_CLAIM_TYPES, lens];
}

// CONTEXT.md "AnalysisClaim": one evidence-bearing statement. A claim with no valid
// citation into its run's frozen EvidenceSet is invalid and never persisted, which
// is where ADR-0002's invariant is enforced — in our code, below the prompt.
@Entity("analysis_claims")
export class AnalysisClaim {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => GenerationRun)
  @JoinColumn({ name: "generationRunId" })
  generationRun!: GenerationRun;

  @Column({ type: "uuid" })
  generationRunId!: string;

  @Column({ type: "varchar" })
  claimType!: ClaimType;

  @Column({ type: "text" })
  text!: string;

  // The order the model returned them in, preserved so a re-read of a run shows the
  // analysis as it was written rather than in whatever order a join comes back.
  @Column({ type: "integer" })
  displayOrder!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
