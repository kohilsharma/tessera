import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Article } from "./Article";
import { ClusteringRun } from "./ClusteringRun";

// Constrained vocabulary (Initial Report Table 2, "Category | enum"). Mirrors the
// stories.category CHECK constraint; IntelligenceBrief's category (#20) reuses it.
export const STORY_CATEGORIES = [
  "politics",
  "business",
  "technology",
  "science",
  "health",
  "world",
  "sports",
  "entertainment",
] as const;
export type StoryCategory = (typeof STORY_CATEGORIES)[number];

@Entity("stories")
export class Story {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", unique: true })
  slug!: string;

  @Column({ type: "varchar" })
  title!: string;

  @Column({ type: "text", nullable: true })
  summary!: string | null;

  @Column({ type: "varchar" })
  category!: StoryCategory;

  // Earliest/latest publishedAt among the Story's Articles — the read model for
  // date-range filtering and default sort, ahead of real clustering (ADR-0009).
  @Column({ type: "timestamptz" })
  firstSeenAt!: Date;

  @Column({ type: "timestamptz" })
  lastSeenAt!: Date;

  @OneToMany(() => Article, (article) => article.story)
  articles!: Article[];

  @ManyToOne(() => ClusteringRun, { nullable: true })
  @JoinColumn({ name: "clusteringRunId" })
  clusteringRun!: ClusteringRun | null;

  @Column({ type: "uuid", nullable: true })
  clusteringRunId!: string | null;

  // Deliberately not mapped, for the same reason Article.embedding is not: the
  // `vector` type is not one TypeORM's postgres driver recognises. The column and
  // its HNSW index exist (migration 1755753000000) and clustering reads and writes
  // it with raw SQL — ADR-0026's centroid, recomputed from the Story's members on
  // every run.

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
