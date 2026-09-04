import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Article } from "../entities/Article";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { mayServeText } from "../entities/Publisher";
import { toPublicArticle } from "../lib/articleView";
import { toPublicLeaning } from "../lib/publisherLeaning";
import { ACCEPTED_ASSIGNMENT } from "../lib/storyMembership";
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
    // A pending Story Assignment (#50) is the same non-record for the same
    // reason: it has a Story, but nobody has decided it is the right one, so
    // serving it would put a machine's borderline guess in front of a reader.
    if (!article || !article.story || article.storyAssignmentStatus !== ACCEPTED_ASSIGNMENT) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    res.json({
      ...toPublicArticle(article),
      // CONTEXT.md "Terms Class" (#40): the Publisher's rights class decides
      // whether its text may be served, so rights enforcement is one rule in one
      // place. Since ADR-0032 the default class clears it, so this is where a
      // reader who asks "says who?" actually reads the reporting; a publisher
      // reclassified by hand is what puts the gate back.
      analysisText: mayServeText(article.publisher.termsClass, article.analysisTextMode)
        ? article.analysisText
        : null,
      // CONTEXT.md "Publisher Leaning" (#85). A top-level key rather than a field
      // inside `publisher`: it is a third party's claim *about* this publisher,
      // not a property of Tessera's record of it, and the shape says so. Null
      // where AllSides has published no rating — the reader is told that, never
      // shown a guess.
      publisherLeaning: toPublicLeaning(article.publisher),
      story: { id: article.story.id, slug: article.story.slug, title: article.story.title },
    });
  }),
);
