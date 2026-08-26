import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
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
      id: article.id,
      title: article.title,
      url: article.url,
      analysisText: article.analysisText,
      analysisTextType: article.analysisTextType,
      publishedAt: article.publishedAt,
      publisher: { id: article.publisher.id, name: article.publisher.name, domain: article.publisher.domain },
      story: { id: article.story.id, slug: article.story.slug, title: article.story.title },
    });
  }),
);
