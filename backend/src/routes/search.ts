import { Router } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { Story, STORY_CATEGORIES } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { toPublicArticle } from "../lib/articleView";
import { parseListQuery, toEnvelope } from "../lib/listQuery";
import { hybridSearchArticleIds } from "../lib/hybridSearch";
import { createEmbeddingProvider } from "../embeddings";

export const searchRouter = Router();

// ADR-0023: hosted provider once GEMINI_API_KEY is configured, Mock otherwise
// (tests, and any dev machine without a key) — seed.ts selects the same way,
// so a query is always embedded comparably to the corpus it searches.
const embedder = createEmbeddingProvider();

searchRouter.get(
  "/search",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.status(422).json({ error: "q is required" });
      return;
    }

    const parsed = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["relevance", "publishedAt"],
      defaultSortBy: "relevance",
      allowedCategories: STORY_CATEGORIES,
    });
    if (!parsed.ok) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    const { page, pageSize, sortBy, sortDir, category, dateFrom, dateTo } = parsed.value;

    const { hits, total } = await hybridSearchArticleIds(
      q,
      { category, dateFrom, dateTo, sortBy, sortDir, page, pageSize },
      embedder,
    );

    if (hits.length === 0) {
      res.json(toEnvelope([], page, pageSize, total));
      return;
    }

    const articles = await AppDataSource.getRepository(Article).find({
      where: { id: In(hits.map((hit) => hit.id)) },
      relations: { publisher: true, story: true },
    });
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
