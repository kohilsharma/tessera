import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { mayRedistribute, toPublicArticle } from "../lib/articleView";
import { isUuid } from "../lib/uuid";

export const articlesRouter = Router();

articlesRouter.get(
  "/articles/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const article = await AppDataSource.getRepository(Article).findOne({
      where: { id: req.params.id },
      relations: { publisher: true, story: true },
    });
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    res.json({
      ...toPublicArticle(article),
      // The one endpoint that serves body text, and only for modes we may
      // redistribute (ADR-0018) — null otherwise, so the client can say so
      // rather than render an empty body.
      analysisText: mayRedistribute(article.analysisTextType) ? article.analysisText : null,
      story: { id: article.story.id, slug: article.story.slug, title: article.story.title },
    });
  }),
);
