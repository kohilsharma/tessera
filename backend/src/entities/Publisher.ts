import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Article } from "./Article";
import type { AnalysisTextMode } from "./Article";

// CONTEXT.md "Terms Class": the per-Publisher rights vocabulary, assigned by hand.
export const TERMS_CLASSES = ["open_metadata", "syndicated_excerpt", "internal_only", "licensed"] as const;
export type TermsClass = (typeof TERMS_CLASSES)[number];

// The rights gate, in one place (#40): whether Tessera may *serve* this
// publisher's text over the API. `Record`, not `Partial` — adding a class fails
// to compile until someone has decided what it may serve, which is the one
// decision that must never be defaulted by accident.
const SERVES_TEXT: Record<TermsClass, boolean> = {
  // Only the metadata is cleared; the text is not, so it is never served.
  open_metadata: false,
  syndicated_excerpt: true,
  // The default for anything a connector creates: held for analysis, never served.
  internal_only: false,
  licensed: true,
};

export function mayServeText(termsClass: TermsClass, mode: AnalysisTextMode): boolean {
  // ADR-0018's floor, inside the class gate rather than beside it: `api_content`
  // is a body Tessera extracted from the page itself (Readability, #46). No
  // publisher's terms grant us that text, because they never handed it to us, so
  // it stays internal whatever the class says. The class decides everything else
  // — `feed_excerpt` is text a publisher syndicated, `licensed_full_text` is text
  // we hold a licence for, `manual_fixture` is our own.
  if (mode === "api_content") return false;
  return SERVES_TEXT[termsClass];
}

// `open_metadata` is the one class whose terms do not let Tessera hold the text
// at all — everything else may be stored for internal analysis (ADR-0018), and
// serving is decided separately above.
export function mayStoreText(termsClass: TermsClass): boolean {
  return termsClass !== "open_metadata";
}

@Entity("publishers")
export class Publisher {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  name!: string;

  @Column({ type: "varchar", unique: true })
  domain!: string;

  // CONTEXT.md "Terms Class". Defaults to the most restrictive class, so a
  // publisher a connector created and nobody has classified never has its text
  // served by accident — the gate fails closed.
  @Column({ type: "varchar", default: "internal_only" })
  termsClass!: TermsClass;

  @OneToMany(() => Article, (article) => article.publisher)
  articles!: Article[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
