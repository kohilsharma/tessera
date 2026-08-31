import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { AnalysisClaim } from "./AnalysisClaim";
import { Article } from "./Article";

// CONTEXT.md "Citation / ClaimEvidence": the link from a Claim to the reporting
// that supports it. One row per (claim, evidence id) — the pairing is the primary
// key, so a model citing A1 twice in one claim is one citation.
//
// It carries both halves on purpose: `evidenceId` is what the model wrote and what
// validation resolved, `articleId` is what a reader follows. Storing only the
// evidence id would make every citation a join through the frozen set to be
// readable; storing only the Article id would lose the handle the claim actually
// cited.
//
// v3 §9.6's `relationship` (supports / contradicts / context / not_found_in) is not
// here: #53's claim contract has no place for a model to state one, and a column
// filled with a constant is not a fact. #54 adds it where it becomes load-bearing —
// a contradiction claim must cite evidence on *both* sides.
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
}
