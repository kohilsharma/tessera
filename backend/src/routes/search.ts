import { Router } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { STORY_CATEGORIES } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { mayRedistribute, toPublicArticle } from "../lib/articleView";
import { parseListQuery, toEnvelope } from "../lib/listQuery";
import { hybridSearchArticleIds, type HybridSearchSortBy } from "../lib/hybridSearch";
import { MockEmbeddingProvider } from "../embeddings/MockEmbeddingProvider";

export const searchRouter = Router();

// ponytail: hardcoded to the Mock provider, same as seed.ts — the corpus was
// itself embedded with Mock, so a query embedded by anything else wouldn't be
// comparable. Swapping in the hosted provider behind this interface for both
// sides together is #23's job, not this ticket's.
const embedder = new MockEmbeddingProvider();

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
      { category, dateFrom, dateTo, sortBy: sortBy as HybridSearchSortBy, sortDir, page, pageSize },
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
      .filter((hit): hit is { article: Article; score: number } => hit.article !== undefined)
      .map(({ article, score }) => ({
        ...toPublicArticle(article),
        analysisText: mayRedistribute(article.analysisTextType) ? article.analysisText : null,
        story: { id: article.story.id, slug: article.story.slug, title: article.story.title },
        score,
      }));

    res.json(toEnvelope(items, page, pageSize, total));
  }),
);
