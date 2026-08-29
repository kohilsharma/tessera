import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Publisher } from "./Publisher";
import { Story } from "./Story";

// CONTEXT.md "Analysis Text Mode": what text is actually available for
// analysis. Product wording must match the weakest mode in an EvidenceSet
// (later ticket). Seed fixtures use manual_fixture (ADR-0007).
export const ANALYSIS_TEXT_MODES = ["feed_excerpt", "api_content", "licensed_full_text", "manual_fixture"] as const;
export type AnalysisTextMode = (typeof ANALYSIS_TEXT_MODES)[number];

@Entity("articles")
export class Article {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => Story, (story) => story.articles)
  @JoinColumn({ name: "storyId" })
  story!: Story;

  @Column({ type: "uuid" })
  storyId!: string;

  @ManyToOne(() => Publisher)
  @JoinColumn({ name: "publisherId" })
  publisher!: Publisher;

  @Column({ type: "uuid" })
  publisherId!: string;

  @Column({ type: "varchar" })
  title!: string;

  @Column({ type: "varchar", unique: true })
  url!: string;

  @Column({ type: "text" })
  analysisText!: string;

  @Column({ type: "varchar" })
  analysisTextMode!: AnalysisTextMode;

  @Column({ type: "timestamptz" })
  publishedAt!: Date;

  // Deliberately not mapped here: pgvector's `vector` type is not one TypeORM's
  // postgres driver recognises, and nothing in Foundation queries it — filtering/
  // sorting are all on the columns above. The DB column + HNSW index exist
  // (migration below) and the seed script writes it with a raw query. #22
  // (hybrid search) is what first needs to read it back, and can map it then.

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
