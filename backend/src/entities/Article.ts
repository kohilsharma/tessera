import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { IngestionConnector } from "./IngestionConnector";
import { Publisher } from "./Publisher";
import { Story } from "./Story";

// CONTEXT.md "Analysis Text Mode": what text is actually available for
// analysis. Product wording must match the weakest mode in an EvidenceSet
// (later ticket). Seed fixtures use manual_fixture (ADR-0007).
export const ANALYSIS_TEXT_MODES = [
  "metadata_only",
  "feed_excerpt",
  "api_content",
  "licensed_full_text",
  "manual_fixture",
] as const;
export type AnalysisTextMode = (typeof ANALYSIS_TEXT_MODES)[number];

// ADR-0024: the modes are an *ordered ladder*, weakest first, and an Article's
// mode only ever moves up — so a later, weaker sighting of the same URL can
// never degrade text we already hold. `manual_fixture` sits outside the ladder
// (it is our own synthetic seed text, not something a publisher gave us) and is
// the one mode deliberately excluded: an unranked mode is one nothing can climb
// over.
//
// `Exclude`, not `Partial`: adding another mode makes this map fail to compile
// until the new rung is deliberately ranked.
const ANALYSIS_TEXT_MODE_RANK: Record<Exclude<AnalysisTextMode, "manual_fixture">, number> = {
  metadata_only: 0,
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

// The same ladder with `manual_fixture` given a rung, which the enrichment ladder
// above deliberately refuses it. Two different questions: "may this sighting replace
// what we hold" (no — a fixture is not something a publisher sent) versus "how much
// of the report did we analyse", which is what an EvidenceSet reports and what decides
// whether an omission may be claimed (#54, ADR-0027). A seed fixture is our own
// synthetic body, complete by construction, so it answers with full text — treating it
// as thin would put the constrained wording on the whole demo corpus.
const EVIDENCE_TEXT_MODE_RANK: Record<AnalysisTextMode, number> = {
  ...ANALYSIS_TEXT_MODE_RANK,
  manual_fixture: ANALYSIS_TEXT_MODE_RANK.licensed_full_text,
};

// ADR-0027: an EvidenceSet's rung is the weakest of its members, because a claim
// comparing coverage is only as good as the thinnest text it rests on. The ladder's
// own order breaks a tie, so two modes of equal rank always report the same one.
export function weakestAnalysisTextMode(modes: AnalysisTextMode[]): AnalysisTextMode | null {
  return (
    [...modes].sort(
      (a, b) =>
        EVIDENCE_TEXT_MODE_RANK[a] - EVIDENCE_TEXT_MODE_RANK[b] ||
        ANALYSIS_TEXT_MODES.indexOf(a) - ANALYSIS_TEXT_MODES.indexOf(b),
    )[0] ?? null
  );
}

// v3 §16.6: "publisher X omitted Y" is only sayable when the full permitted report is
// what was analysed. Anything below that is an excerpt, and absence from an excerpt is
// not absence from the reporting.
export function carriesFullPermittedText(mode: AnalysisTextMode): boolean {
  return EVIDENCE_TEXT_MODE_RANK[mode] >= EVIDENCE_TEXT_MODE_RANK.licensed_full_text;
}

// CONTEXT.md "Story Assignment": the state that decides whether anyone can see an
// Article's membership. `auto_accepted` scored above the similarity threshold;
// `pending_review` fell into the band beneath it and is a proposal awaiting an
// Admin (ADR-0026, #50). Null is an Unclustered Article — no Story, no decision.
//
// Consequence worth stating where the column is: a `pending_review` row carries a
// `storyId`, so `storyId IS NOT NULL` is *not* what "in a Story" means on a read
// path. Every reader-facing surface tests the status instead — see
// lib/storyMembership.ts, which is the one place that predicate is written.
export const STORY_ASSIGNMENT_STATUSES = ["auto_accepted", "pending_review"] as const;
export type StoryAssignmentStatus = (typeof STORY_ASSIGNMENT_STATUSES)[number];

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

  // ADR-0026: membership carries the decision and score that produced it.
  // Unclustered Articles have neither.
  @Column({ type: "varchar", nullable: true })
  storyAssignmentStatus!: StoryAssignmentStatus | null;

  @Column({ type: "double precision", nullable: true })
  storyAssignmentScore!: number | null;

  @ManyToOne(() => Publisher)
  @JoinColumn({ name: "publisherId" })
  publisher!: Publisher;

  @Column({ type: "uuid" })
  publisherId!: string;

  @Column({ type: "varchar" })
  title!: string;

  @Column({ type: "varchar", unique: true })
  url!: string;

  @Column({ type: "text", nullable: true })
  analysisText!: string | null;

  @Column({ type: "varchar" })
  analysisTextMode!: AnalysisTextMode;

  // GKG's average document tone for this article (ADR-0024 keeps field 16 and
  // drops GCAM). Null for every other source: nothing else reports tone, and 0
  // would assert a neutrality nobody measured. Retained for the Phase-3.5
  // timeline overlay (ADR-0020) — nothing reads it yet.
  @Column({ type: "double precision", nullable: true })
  tone!: number | null;

  @Column({ type: "timestamptz" })
  publishedAt!: Date;

  // #47. When Readability last tried this Article's page, success or failure —
  // the one thing that makes extraction a bounded pass rather than a crawler.
  // Failure leaves the mode untouched (ADR-0018 expects paywalls), so without a
  // mark every run would re-fetch the same failures forever and never reach
  // anything new. Null means never attempted, which is every Article until an
  // extraction run picks it up.
  //
  // ponytail: one attempt per Article, ever — a page that timed out once is never
  // retried. The upgrade path is an attempt count plus a backoff interval, if a
  // measurable share of failures turn out to be transient.
  @Column({ type: "timestamptz", nullable: true })
  extractionAttemptedAt!: Date | null;

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
