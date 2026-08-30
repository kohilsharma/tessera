import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { IngestionConnector } from "./IngestionConnector";
import { Publisher } from "./Publisher";
import { Story } from "./Story";

// CONTEXT.md "Analysis Text Mode": what text is actually available for
// analysis. Product wording must match the weakest mode in an EvidenceSet
// (later ticket). Seed fixtures use manual_fixture (ADR-0007).
export const ANALYSIS_TEXT_MODES = ["feed_excerpt", "api_content", "licensed_full_text", "manual_fixture"] as const;
export type AnalysisTextMode = (typeof ANALYSIS_TEXT_MODES)[number];

// ADR-0024: the modes are an *ordered ladder*, weakest first, and an Article's
// mode only ever moves up — so a later, weaker sighting of the same URL can
// never degrade text we already hold. `manual_fixture` sits outside the ladder
// (it is our own synthetic seed text, not something a publisher gave us) and is
// the one mode deliberately excluded: an unranked mode is one nothing can climb
// over.
//
// `Exclude`, not `Partial`: when #41 adds `metadata_only` as the new weakest
// rung, this map must fail to compile until it is ranked. Left partial, a
// `metadata_only` Article would silently be unrankable and so could never be
// enriched up to `feed_excerpt` — exactly the lost text ADR-0024 exists to
// prevent, and it would fail silently.
const ANALYSIS_TEXT_MODE_RANK: Record<Exclude<AnalysisTextMode, "manual_fixture">, number> = {
  feed_excerpt: 1,
  api_content: 2,
  licensed_full_text: 3,
};

function isLadderMode(mode: AnalysisTextMode): mode is keyof typeof ANALYSIS_TEXT_MODE_RANK {
  return mode in ANALYSIS_TEXT_MODE_RANK;
}

export function isStrongerAnalysisTextMode(candidate: AnalysisTextMode, held: AnalysisTextMode): boolean {
  if (!isLadderMode(candidate) || !isLadderMode(held)) return false;
  return ANALYSIS_TEXT_MODE_RANK[candidate] > ANALYSIS_TEXT_MODE_RANK[held];
}

@Entity("articles")
export class Article {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // Nullable: CONTEXT.md "Unclustered Article" — everything ingestion produces
  // has no Story until Phase 3 clusters it, and every public read path joins
  // through Story, so an unclustered Article is invisible by construction.
  @ManyToOne(() => Story, (story) => story.articles)
  @JoinColumn({ name: "storyId" })
  story!: Story | null;

  @Column({ type: "uuid", nullable: true })
  storyId!: string | null;

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

  // Which connector found this. Null for seeded fixtures, which nothing
  // discovered (ADR-0007) — so provenance is answerable per Article without
  // pretending the demo corpus arrived over the wire.
  @ManyToOne(() => IngestionConnector)
  @JoinColumn({ name: "discoveredByConnectorId" })
  discoveredByConnector!: IngestionConnector | null;

  @Column({ type: "uuid", nullable: true })
  discoveredByConnectorId!: string | null;

  // Deliberately not mapped here: pgvector's `vector` type is not one TypeORM's
  // postgres driver recognises, and nothing in Foundation queries it — filtering/
  // sorting are all on the columns above. The DB column + HNSW index exist
  // (migration below) and the seed script writes it with a raw query. #22
  // (hybrid search) is what first needs to read it back, and can map it then.

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
