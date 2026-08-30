import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { mayServeText } from "../entities/Publisher";
import { toPublicArticle } from "../lib/articleView";
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
    // An Unclustered Article (CONTEXT.md) is not a public record: everything
    // ingestion produces has no Story until Phase 3 clusters it, and this
    // endpoint's response is shaped around the Story it belongs to. 404 rather
    // than a partial record — a 200 with a null Story would make "not clustered
    // yet" look like a public state, and dereferencing the absent Story below
    // would be a 500.
    if (!article || !article.story) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    res.json({
      ...toPublicArticle(article),
      // CONTEXT.md "Terms Class" (#40): the Publisher's rights class decides
      // whether its text may be served, so rights enforcement is one rule in one
      // place. Anything a connector created is `internal_only` until someone
      // classifies it by hand, so the gate fails closed.
      analysisText: mayServeText(article.publisher.termsClass, article.analysisTextMode)
        ? article.analysisText
        : null,
      story: { id: article.story.id, slug: article.story.slug, title: article.story.title },
    });
  }),
);
