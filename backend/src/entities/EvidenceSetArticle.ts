import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Article } from "./Article";
import { EvidenceSet } from "./EvidenceSet";

// Why an Article was selected (ADR-0027: selection is deterministic and
// model-free, so every row can say what put it here). `centroid_rank` is the
// ranked body of the set; the other two are ADR-0010 §16.2's forced inclusions,
// which are what stop a set from being ten variations on the same hour.
export const SELECTION_REASONS = ["earliest_reporting", "latest_reporting", "centroid_rank"] as const;
export type SelectionReason = (typeof SELECTION_REASONS)[number];

// v3 §16.3's frozen row, verbatim: the stable evidence id a claim cites, the hash
// of the Article's *full* analysis text, the exact excerpt that was sent, the
// reason it was chosen and where it ranked.
//
// The hash covers the full text rather than the excerpt on purpose (ADR-0027):
// hashing only what we sent would miss a body replaced underneath an excerpt that
// happens to start the same way.
@Entity("evidence_set_articles")
export class EvidenceSetArticle {
  @PrimaryColumn({ type: "uuid" })
  evidenceSetId!: string;

  @PrimaryColumn({ type: "uuid" })
  articleId!: string;

  @ManyToOne(() => EvidenceSet)
  @JoinColumn({ name: "evidenceSetId" })
  evidenceSet!: EvidenceSet;

  @ManyToOne(() => Article)
  @JoinColumn({ name: "articleId" })
  article!: Article;

  // `A1`, `A2`, … — stable within its set and the only handle a claim may cite.
  // Assigned in rank order, so A1 is the reporting closest to the Story centroid.
  @Column({ type: "varchar" })
  evidenceId!: string;

  @Column({ type: "varchar" })
  articleContentHash!: string;

  @Column({ type: "integer" })
  sourceRank!: number;

  @Column({ type: "varchar" })
  selectionReason!: SelectionReason;

  @Column({ type: "text" })
  includedExcerptSnapshot!: string;
}
