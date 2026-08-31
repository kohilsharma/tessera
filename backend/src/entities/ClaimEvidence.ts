import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { AnalysisClaim } from "./AnalysisClaim";
import { Article } from "./Article";

// CONTEXT.md "Citation / ClaimEvidence": the link from a Claim to the reporting
// behind it. One row per (claim, evidence id) — the pairing is the primary key, so
// a model citing A1 twice in one claim is one citation.
//
// It carries both halves on purpose: `evidenceId` is what the model wrote and what
// validation resolved, `articleId` is what a reader follows. Storing only the
// evidence id would make every citation a join through the frozen set to be
// readable; storing only the Article id would lose the handle the claim actually
// cited. `relationship` is nullable only for analyses created before #56 recorded
// contradiction polarity; new claims always persist it.
export const CLAIM_EVIDENCE_RELATIONSHIPS = ["supports", "contradicts"] as const;
export type ClaimEvidenceRelationship = (typeof CLAIM_EVIDENCE_RELATIONSHIPS)[number];

@Entity("claim_evidence")
export class ClaimEvidence {
  @PrimaryColumn({ type: "uuid" })
  claimId!: string;

  @PrimaryColumn({ type: "varchar" })
  evidenceId!: string;

  @ManyToOne(() => AnalysisClaim)
  @JoinColumn({ name: "claimId" })
  claim!: AnalysisClaim;

  @ManyToOne(() => Article)
  @JoinColumn({ name: "articleId" })
  article!: Article;

  @Column({ type: "uuid" })
  articleId!: string;

  @Column({ type: "varchar", nullable: true })
  relationship!: ClaimEvidenceRelationship | null;
}
