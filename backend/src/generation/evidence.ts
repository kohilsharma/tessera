import { createHash } from "node:crypto";
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { weakestAnalysisTextMode, type AnalysisTextMode } from "../entities/Article";
import { EvidenceSet } from "../entities/EvidenceSet";
import { EvidenceSetArticle, type SelectionReason } from "../entities/EvidenceSetArticle";
import type { TermsClass } from "../entities/Publisher";
import { acceptedCentroid, acceptedMembership } from "../lib/storyMembership";
import {
  EXCERPT_CHARS,
  MAX_ARTICLES_PER_PUBLISHER,
  MAX_EVIDENCE_ARTICLES,
  NEAR_DUPLICATE_SIMILARITY,
} from "./config";

// ADR-0027: no model participates in choosing evidence. Evidence a model selected
// is evidence nobody can re-derive, which defeats the point of freezing it — so
// everything here is a rank, a bound and a tiebreak, and the same corpus produces
// the same set every time.

// One eligible member of the Story, with the rank the centroid gave it.
type Candidate = {
  articleId: string;
  title: string;
  url: string;
  publishedAt: Date;
  analysisText: string;
  analysisTextMode: AnalysisTextMode;
  publisherId: string;
  publisherName: string;
  publisherDomain: string;
  termsClass: TermsClass;
  sourceRank: number;
};

// A row of the set, in memory, before it is frozen. Everything the prompt needs and
// everything the frozen row stores — deliberately the same object, because "the
// exact excerpt snapshot used" (v3 §16.3) is only true if what is stored is what was
// sent.
export type SelectedEvidence = Candidate & {
  evidenceId: string;
  articleContentHash: string;
  selectionReason: SelectionReason;
  excerpt: string;
};

export function contentHashOf(analysisText: string): string {
  return createHash("sha256").update(analysisText).digest("hex");
}

// ADR-0027's reuse key, evidence half: the exact frozen rows in evidence-id
// order. Full-text hashes catch enrichment, while Article ids and provenance stop a
// different report (or changed model-visible metadata) from inheriting an old run.
export function evidenceContentHash(selected: SelectedEvidence[]): string {
  const digest = createHash("sha256");
  for (const row of selected) {
    digest.update(
      `${JSON.stringify([
        row.evidenceId,
        row.articleId,
        row.articleContentHash,
        row.title,
        row.url,
        row.publishedAt.toISOString(),
        row.analysisTextMode,
        row.publisherId,
        row.publisherName,
        row.publisherDomain,
        row.sourceRank,
        row.selectionReason,
        row.excerpt,
      ])}\n`,
    );
  }
  return digest.digest("hex");
}

// `[A1]` is the citation syntax, so nothing that reaches the model inside an evidence
// block may contain a square bracket: an article quoting "[sic]" — or a headline
// tagged "[Video]", which RSS and GDELT produce constantly — would otherwise hand the
// model a token shaped like an evidence id. Worse, a title containing `[A2]` would be
// a citation that *resolves*, to the wrong Article, which validation cannot catch.
// Applied to every interpolated field (see prompt.ts), not only the body.
export function withoutCitationBrackets(text: string): string {
  return text.replace(/\[/g, "(").replace(/\]/g, ")");
}

// The excerpt is deterministic: collapse whitespace, cut at a word boundary. Nothing
// here samples, summarises or reorders — two runs over the same body produce the
// same characters, which is what makes a frozen set reproducible from the corpus.
//
// Not quite v3 §16.3's "exact excerpt snapshot": brackets are neutralised before
// freezing, deliberately, so that what is stored is what was sent. A snapshot that
// differs from the prompt by one character would make the frozen row a description of
// the request rather than a copy of it.
export function excerptOf(analysisText: string): string {
  const collapsed = withoutCitationBrackets(analysisText.replace(/\s+/g, " ").trim());
  if (collapsed.length <= EXCERPT_CHARS) return collapsed;
  const cut = collapsed.slice(0, EXCERPT_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > EXCERPT_CHARS - 200 ? cut.slice(0, lastSpace) : cut}…`;
}

// Eligible reporting, ranked. Three things make a member eligible: an accepted Story
// Assignment (#50 — a pending proposal is a machine's guess and must never ground a
// claim), analysis text with something in it, and a Story whose centroid can be
// computed. Emptiness is tested, not only NULL: a whitespace-only body would otherwise
// take one of the ten slots and become a citable evidence id backed by nothing.
//
// The centroid is `acceptedCentroid`, the same mean clustering scores against, rather
// than the stored `stories."embedding"`: a Story that has not been through a
// clustering run since its last member joined has a stale or null centroid, and
// generation must not depend on when a job last ticked.
//
// ponytail: the centroid subquery is correlated per row rather than computed once.
// A Story holds tens of members, so this is one small query either way; hoist it
// into a CTE if a Story ever holds enough members to notice.
async function rankedCandidates(storyId: string): Promise<Candidate[]> {
  const rows: (Omit<Candidate, "sourceRank"> & { distance: string | null })[] = await AppDataSource.query(
    `SELECT a."id" AS "articleId", a."title", a."url", a."publishedAt", a."analysisText", a."analysisTextMode",
            p."id" AS "publisherId", p."name" AS "publisherName", p."domain" AS "publisherDomain", p."termsClass",
            CASE WHEN a."embedding" IS NULL THEN NULL ELSE a."embedding" <=> ${acceptedCentroid("s")} END AS distance
       FROM "articles" a
       JOIN "publishers" p ON p."id" = a."publisherId"
       JOIN "stories" s ON s."id" = a."storyId"
      WHERE a."storyId" = $1
        AND ${acceptedMembership("a")}
        AND a."analysisText" ~ '[^[:space:]]'
      -- Relevance first, then chronology, then id: an unembedded member ranks last
      -- rather than dropping out, so a Story whose vectors were just cleared by
      -- enrichment can still be analysed.
      ORDER BY distance ASC NULLS LAST, a."publishedAt" ASC, a."id" ASC`,
    [storyId],
  );
  return rows.map(({ distance: _distance, ...row }, index) => ({ ...row, sourceRank: index + 1 }));
}

// The pairs among the candidates that are the same report twice — ADR-0027's wire-copy
// collapse, measured in the same space clustering scores in. Only pairs above the floor
// come back, so the result is small even though the comparison is not: `<=>` in a join
// predicate is an exact nested-loop scan over every eligible pair, which no vector index
// serves. A Story holds tens of eligible members, so this is one small query.
//
// ponytail: O(n²) over a Story's eligible members, which is fine at tens and would not be
// at thousands. Restricting the pair query to the candidates that can actually be selected
// is the upgrade, and it needs the bounds applied first.
//
// An unembedded member is nobody's duplicate: absence of a vector is not evidence of
// difference, and dropping it instead would silently shrink a set after enrichment cleared
// a vector. The consequence is that the "counts newsrooms" guarantee below is conditional
// on the members being embedded — a wire reprint enriched moments ago can still take a
// second masthead's slot until the next clustering run re-embeds it.
const pairKey = (left: string, right: string): string => (left < right ? `${left}|${right}` : `${right}|${left}`);

async function nearDuplicatePairs(articleIds: string[]): Promise<Set<string>> {
  if (articleIds.length < 2) return new Set();
  const rows: { leftId: string; rightId: string }[] = await AppDataSource.query(
    `SELECT a."id" AS "leftId", b."id" AS "rightId"
       FROM "articles" a
       JOIN "articles" b ON b."id" > a."id" AND b."id" = ANY($1::uuid[]) AND b."embedding" IS NOT NULL
      WHERE a."id" = ANY($1::uuid[]) AND a."embedding" IS NOT NULL
        AND (a."embedding" <=> b."embedding") < $2`,
    [articleIds, 1 - NEAR_DUPLICATE_SIMILARITY],
  );
  return new Set(rows.map((row) => pairKey(row.leftId, row.rightId)));
}

// v3 §16.2's bounds over that ranking. Order matters: the two forced inclusions are
// taken first, because a set of the ten Articles closest to a centroid is ten
// variations on the same hour, and "how this story developed" needs its ends.
function applyBounds(
  ranked: Candidate[],
  duplicates: Set<string>,
): { candidate: Candidate; selectionReason: SelectionReason }[] {
  const byTime = [...ranked].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime() || a.articleId.localeCompare(b.articleId),
  );
  const selected = new Map<string, { candidate: Candidate; selectionReason: SelectionReason }>();
  const perPublisher = new Map<string, number>();

  const take = (candidate: Candidate, selectionReason: SelectionReason): void => {
    if (selected.has(candidate.articleId)) return;
    // The collapse applies whichever rule pulled a candidate in, including the two
    // forced ends of the coverage window. A Story that is one wire report has the same
    // text at both ends, and forcing the second copy in would leave a set claiming two
    // independent publishers where there is one newsroom — which is exactly the count
    // the minimum-publisher refusal reads. The earliest is never collapsed, nothing
    // being selected before it, so a set is never empty for this reason.
    //
    // A collapsed *latest* is not replaced by the next-latest: the rank loop below can
    // still pull a distinct later report in, but as `centroid_rank`, so a set can carry
    // no `latest_reporting` row at all. That is the honest outcome — the end of the
    // window was a copy of its start — and retrying down the list would be inventing a
    // span the reporting does not have.
    if ([...selected.keys()].some((held) => duplicates.has(pairKey(held, candidate.articleId)))) return;
    selected.set(candidate.articleId, { candidate, selectionReason });
    perPublisher.set(candidate.publisherId, (perPublisher.get(candidate.publisherId) ?? 0) + 1);
  };

  // A one-Article Story's sole member is its earliest reporting; first write wins,
  // so it is not also recorded as its latest.
  if (byTime.length > 0) take(byTime[0], "earliest_reporting");
  if (byTime.length > 1) take(byTime[byTime.length - 1], "latest_reporting");

  for (const candidate of ranked) {
    if (selected.size >= MAX_EVIDENCE_ARTICLES) break;
    // The per-publisher cap counts the forced inclusions: they are two of the ten,
    // not exemptions from the bound that keeps one masthead from carrying a set.
    if ((perPublisher.get(candidate.publisherId) ?? 0) >= MAX_ARTICLES_PER_PUBLISHER) continue;
    take(candidate, "centroid_rank");
  }

  // Back into rank order for evidence-id assignment, so A1 is always the reporting
  // closest to the centroid whichever rule pulled it in.
  return [...selected.values()].sort((a, b) => a.candidate.sourceRank - b.candidate.sourceRank);
}

// The whole of selection: rank, collapse, bound, snapshot. Returns an empty array for a
// Story with nothing to analyse, which the caller refuses rather than prompting over.
export async function selectEvidence(storyId: string): Promise<SelectedEvidence[]> {
  const ranked = await rankedCandidates(storyId);
  const bounded = applyBounds(ranked, await nearDuplicatePairs(ranked.map((row) => row.articleId)));
  return bounded.map(({ candidate, selectionReason }, index) => ({
    ...candidate,
    evidenceId: `A${index + 1}`,
    articleContentHash: contentHashOf(candidate.analysisText),
    selectionReason,
    excerpt: excerptOf(candidate.analysisText),
  }));
}

export function distinctPublisherCount(selected: SelectedEvidence[]): number {
  return new Set(selected.map((row) => row.publisherId)).size;
}

// ADR-0027: the set's rung is the weakest among its members, and it is what decides
// whether the prompt carries v3 §16.6's constrained wording and whether an omission
// claim may stand. The fallback is unreachable — selection refuses an empty set before
// anything asks — and is here because a type that admits null is honest about it.
export function evidenceDataMode(selected: SelectedEvidence[]): AnalysisTextMode {
  return weakestAnalysisTextMode(selected.map((row) => row.analysisTextMode)) ?? "metadata_only";
}

// The freeze itself, before a single token is sent. One transaction, so a set is
// either whole or absent — a half-written set would be a citation resolving to
// nothing.
export async function freezeEvidence(storyId: string, selected: SelectedEvidence[]): Promise<EvidenceSet> {
  return AppDataSource.transaction(async (manager) => {
    const set = await manager.getRepository(EvidenceSet).save({
      storyId,
      contentHash: evidenceContentHash(selected),
      articleCount: selected.length,
      distinctPublisherCount: distinctPublisherCount(selected),
      dataMode: evidenceDataMode(selected),
    });
    await manager.getRepository(EvidenceSetArticle).insert(
      selected.map((row) => ({
        evidenceSetId: set.id,
        articleId: row.articleId,
        evidenceId: row.evidenceId,
        articleContentHash: row.articleContentHash,
        sourceRank: row.sourceRank,
        selectionReason: row.selectionReason,
        includedExcerptSnapshot: row.excerpt,
        titleSnapshot: row.title,
        urlSnapshot: row.url,
        publishedAtSnapshot: row.publishedAt,
        analysisTextModeSnapshot: row.analysisTextMode,
        publisherIdSnapshot: row.publisherId,
        publisherNameSnapshot: row.publisherName,
        publisherDomainSnapshot: row.publisherDomain,
      })),
    );
    return set;
  });
}

// v3 §16.5's last rejection: an `articleContentHash` that no longer matches at
// persist time. The window is real — enrichment runs on the worker while a reader
// waits on a model — and what it would otherwise persist is claims about text
// Tessera has already replaced. Locked in id order, the order every membership
// writer uses, so this cannot deadlock against clustering or review.
//
// Membership is revalidated in the same locked read, because the other thing that can
// move under a model call is the Story itself: a review rejection or a merge can leave
// an Article that was an accepted member when its evidence was frozen no longer one,
// and a set claiming to be "this Story's reporting" would then include reporting that
// is not. Both are one condition to a reader — the evidence changed — so both answer
// through one failure code, with the message saying which.
export async function frozenEvidenceChanged(
  manager: EntityManager,
  storyId: string,
  frozen: SelectedEvidence[],
): Promise<boolean> {
  const rows: { id: string; analysisText: string | null; member: boolean }[] = await manager.query(
    `SELECT "id", "analysisText",
            ("storyId" = $2 AND ${acceptedMembership(`"articles"`)}) AS member
       FROM "articles" WHERE "id" = ANY($1::uuid[]) ORDER BY "id" FOR UPDATE`,
    [frozen.map((row) => row.articleId), storyId],
  );
  const held = new Map(rows.map((row) => [row.id, row]));
  return frozen.some((row) => {
    const current = held.get(row.articleId);
    if (!current || !current.member) return true;
    return current.analysisText == null || contentHashOf(current.analysisText) !== row.articleContentHash;
  });
}
