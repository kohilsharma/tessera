import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Article } from "./Article";
import type { AnalysisTextMode } from "./Article";

// CONTEXT.md "Terms Class": the per-Publisher rights vocabulary, assigned by hand.
export const TERMS_CLASSES = ["open_metadata", "syndicated_excerpt", "internal_only", "licensed"] as const;
export type TermsClass = (typeof TERMS_CLASSES)[number];

// ADR-0032: the class alone decides, for every rung of the ladder. `api_content`
// used to be refused whatever the class, on the reasoning that an extracted body
// is text no publisher handed us — which left a citation opening onto nothing for
// exactly the text Tessera fetched, stored, embedded and reasoned over. A
// `licensed` publisher now clears every rung; the two classes that cleared no
// text still clear none, so re-tightening is a reclassification rather than a
// code change.
export function mayServeText(termsClass: TermsClass, mode: AnalysisTextMode): boolean {
  return termsClass === "licensed" || (termsClass === "syndicated_excerpt" && mode === "feed_excerpt");
}

// Storing a body for internal analysis — enrichment, embeddings, evidence
// selection — is cleared globally rather than per class (ADR-0032, relaxing
// ADR-0018's "per-source `terms_class` gates storage"). `open_metadata` used to
// refuse it, and ingestion answered by throwing away the whole sighting: a day's
// reporting from that publisher vanished, its open metadata with it. This is the
// one place the storage policy is stated, and the one line a re-tightening edits.
export function mayStoreText(_termsClass: TermsClass): boolean {
  return true;
}

@Entity("publishers")
export class Publisher {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  name!: string;

  @Column({ type: "varchar", unique: true })
  domain!: string;

  // CONTEXT.md "Terms Class". Defaults to `licensed` (ADR-0032): this is a
  // non-commercial course build, and the fail-closed `internal_only` default it
  // replaces meant every publisher a connector discovered — which is all of them
  // outside the seed — had its text held back from the reader who asked "says
  // who?". Reclassifying one by hand is what narrows it again.
  @Column({ type: "varchar", default: "licensed" })
  termsClass!: TermsClass;

  @OneToMany(() => Article, (article) => article.publisher)
  articles!: Article[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
