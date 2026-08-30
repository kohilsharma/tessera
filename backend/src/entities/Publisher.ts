import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Article } from "./Article";
import type { AnalysisTextMode } from "./Article";

// CONTEXT.md "Terms Class": the per-Publisher rights vocabulary, assigned by hand.
export const TERMS_CLASSES = ["open_metadata", "syndicated_excerpt", "internal_only", "licensed"] as const;
export type TermsClass = (typeof TERMS_CLASSES)[number];

export function mayServeText(termsClass: TermsClass, mode: AnalysisTextMode): boolean {
  // `api_content` is always internal (ADR-0018). Every other combination is
  // fail-closed unless the Publisher cleared that exact strength of text.
  return (
    mode !== "api_content" &&
    (termsClass === "licensed" || (termsClass === "syndicated_excerpt" && mode === "feed_excerpt"))
  );
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
