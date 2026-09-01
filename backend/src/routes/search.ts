import { Router } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { Story, STORY_CATEGORIES } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { toPublicArticle } from "../lib/articleView";
import { parseListQuery, toEnvelope } from "../lib/listQuery";
import { hybridSearchArticleIds, type HybridSearchFilters, type HybridSearchResult } from "../lib/hybridSearch";
import { buildTimeline, toLanes } from "../timeline/buildTimeline";
import { createEmbeddingProvider } from "../embeddings";

export const searchRouter = Router();

// ADR-0023: hosted provider once GEMINI_API_KEY is configured, Mock otherwise
// (tests, and any dev machine without a key) — seed.ts selects the same way,
// so a query is always embedded comparably to the corpus it searches.
const embedder = createEmbeddingProvider();

// The parse-and-rank both readings of a search share: one accepted vocabulary, one
// relevance, one load of the Articles behind the hits. It is a function rather than a
// block in each handler because the timeline reading's whole contract is that it ranks a
// query with the *same relevance* the ranked list does (#65) — two copies of this is how
// the two would come to disagree about what matched.
//
// `cap` is the one thing they differ on: a list pages, an axis is a set. Given, it is both
// the reader's validated page-size ceiling and the size the axis reads, so the number is
// never written past the parse that bounds it — and the ranking is pinned to relevance,
// because the cap chooses *which* matches the axis carries and a reader on a route with no
// sort control should not have that decided by a param they cannot see. `page`/`pageSize`
// are still accepted and ignored: /search hands its whole query string over when a reader
// switches readings, and dead-ending that on a 422 is the point of accepting them.
//
// Discriminated on `ok` like the parse it wraps (lib/listQuery.ts), so one convention
// covers the whole path from query string to hits.
type Matches = {
  ok: true;
  hits: HybridSearchResult["hits"];
  total: number;
  filters: HybridSearchFilters;
  articles: Article[];
};

async function matchesFor(
  query: Record<string, unknown>,
  cap?: number,
): Promise<Matches | { ok: false; error: string }> {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  if (!q) return { ok: false, error: "q is required" };

  const parsed = parseListQuery(query, {
    allowedSortBy: ["relevance", "publishedAt"],
    defaultSortBy: "relevance",
    allowedCategories: STORY_CATEGORIES,
    maxPageSize: cap,
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const filters: HybridSearchFilters = cap
    ? { ...parsed.value, sortBy: "relevance", sortDir: "desc", page: 1, pageSize: cap }
    : parsed.value;

  const { hits, total } = await hybridSearchArticleIds(q, filters, embedder);
  return {
    ok: true,
    hits,
    total,
    filters,
    // `In([])` is not a query worth making, and each caller states an empty result its own
    // way — an empty envelope is not an empty axis.
    articles: hits.length
      ? await AppDataSource.getRepository(Article).find({
          where: { id: In(hits.map((hit) => hit.id)) },
          relations: { publisher: true, story: true },
        })
      : [],
  };
}

searchRouter.get(
  "/search",
  requireAuth,
  asyncHandler(async (req, res) => {
    const matches = await matchesFor(req.query as Record<string, unknown>);
    if (!matches.ok) {
      res.status(422).json({ error: matches.error });
      return;
    }
    const {
      hits,
      total,
      filters: { page, pageSize },
      articles,
    } = matches;

    const byId = new Map(articles.map((article) => [article.id, article]));
    // Re-order to the fused rank: `In(ids)` makes no ordering promise of its own.
    const items = hits
      .map((hit) => ({ article: byId.get(hit.id), score: hit.score }))
      // The Story is non-null by construction — hybridSearch inner-joins stories
      // in both its lexical CTE and its filter, so an Unclustered Article can
      // never be a hit (ADR-0007: ingested reporting stays out of search). The
      // narrowing is here so that stays a type-level fact rather than a comment.
      .filter((hit): hit is { article: Article & { story: Story }; score: number } => hit.article?.story != null)
      // No analysisText: a result list is not the Article detail endpoint, and
      // that endpoint stays the only place body text is served (ADR-0018).
      .map(({ article, score }) => ({
        ...toPublicArticle(article),
        story: { id: article.story.id, slug: article.story.slug, title: article.story.title },
        score,
      }));

    res.json(toEnvelope(items, page, pageSize, total));
  }),
);

// #65: the same query's matches on one time axis, grouped into a lane per Story. Both
// halves are reuses, and that is the ticket: relevance is `matchesFor`'s above — the very
// function the ranked list ranks with, so both readings rank one query one way — and the
// axis is the timeline seam's, which takes a *set of Articles* precisely so this route
// needs no second projection onto time (timeline/buildTimeline.ts).
//
// Accepted Story membership is joined through by the search itself, so the firehose stays
// invisible here for the same reason it is invisible on /search (ADR-0028) — a new surface
// does not get its own membership rule.
const TIMELINE_MATCH_CAP = 200;

searchRouter.get(
  "/search/timeline",
  requireAuth,
  asyncHandler(async (req, res) => {
    // ponytail: the axis is the most relevant matches up to this cap, not every match. A
    // timeline is a *set*, so it cannot page, and an unbounded one would draw a lane per
    // Story in the corpus for a broad query. The true match count comes back beside it, so
    // the reader is told when they are seeing a cap rather than everything — the one thing
    // the two readings do not share, a list page being smaller again. Raise it when a demo
    // query legitimately spans more.
    const matches = await matchesFor(req.query as Record<string, unknown>, TIMELINE_MATCH_CAP);
    if (!matches.ok) {
      res.status(422).json({ error: matches.error });
      return;
    }
    const { total, articles } = matches;

    // No analytical events on this axis: they are facts about one Story's history, and a
    // lane routes into that Story to read them (#64). What this axis carries is reporting.
    const timeline = buildTimeline(articles, []);
    // Narrowed rather than assumed, as in the list above: search cannot return an
    // Unclustered Article, and the type says so here instead of a comment.
    const stories = new Map(
      articles
        .filter((article): article is Article & { story: Story } => article.story != null)
        .map((article) => [article.story.id, article.story]),
    );

    res.json({
      ...timeline,
      total,
      // A lane names its Story, so it can be read and opened — the same projection a result
      // row carries above, for the same reason. The counts are the seam's, bucketed against
      // the shared axis rather than the lane's own span.
      lanes: toLanes(timeline).flatMap((lane) => {
        const story = stories.get(lane.storyId);
        return story
          ? [{ story: { id: story.id, slug: story.slug, title: story.title }, volume: lane.volume }]
          : [];
      }),
    });
  }),
);
