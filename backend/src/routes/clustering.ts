import { Router } from "express";
import { AppDataSource } from "../data-source";
import { enqueueClusteringRun } from "../clustering/queue";
import { ASSIGNMENT_DECISIONS, decidePendingAssignment, type AssignmentDecision } from "../clustering/review";
import { Article } from "../entities/Article";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { toPublicArticle } from "../lib/articleView";
import { paginate, parseListQuery, toEnvelope } from "../lib/listQuery";
import { PENDING_ASSIGNMENT } from "../lib/storyMembership";
import { isUuid } from "../lib/uuid";

export const clusteringRouter = Router();

// ADR-0004: operating the pipeline is an Admin capability — a Student or Investor
// gets 403 on every route here, and an anonymous caller 401 (requireAuth).
const adminOnly = [requireAuth, requireRole("admin")] as const;

// The trigger enqueues and the worker executes, exactly as ingestion's does (#42):
// the hourly scheduler feeds the same queue, so there is one execution path and
// what is demoed is what runs. History is read back from Postgres (ADR-0026), never
// the queue, so the Admin console renders with the worker stopped.
//
// A collection POST with no id, unlike ingestion's per-connector trigger: clustering
// is one pass over the whole corpus, so there is nothing to name in the path.
// Pressing it twice while a run is queued or in flight is a no-op (clustering/
// queue.ts), so a second press is accepted and adds no second run.
clusteringRouter.post(
  "/clustering/runs",
  ...adminOnly,
  asyncHandler(async (_req, res) => {
    await enqueueClusteringRun();
    res.status(202).json({ status: "accepted" });
  }),
);

// The review queue (#50). Every row is a proposal the job made and would not
// commit: the Article, the Story it was proposed for, and the similarity behind the
// proposal — which is the whole of what a reviewer decides on, so it is the whole
// of what this returns.
//
// Sorted by score by default, descending: the most confident proposals are the
// cheapest to decide, so a reviewer working top-down clears the queue fastest.
// Ordered by publication date instead when an operator wants the newest reporting.
clusteringRouter.get(
  "/clustering/pending",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const parsed = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["storyAssignmentScore", "publishedAt"],
      defaultSortBy: "storyAssignmentScore",
    });
    if (!parsed.ok) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    const { page, pageSize, sortBy, sortDir } = parsed.value;

    const qb = AppDataSource.getRepository(Article)
      .createQueryBuilder("article")
      // Inner joins: a pending assignment has a Story by definition, and this is
      // the one read path in the app where that Story is deliberately not the
      // accepted kind.
      .innerJoinAndSelect("article.story", "story")
      .innerJoinAndSelect("article.publisher", "publisher")
      .where(`article."storyAssignmentStatus" = :status`, { status: PENDING_ASSIGNMENT })
      .orderBy(`article.${sortBy}`, sortDir === "asc" ? "ASC" : "DESC");

    const { items, total } = await paginate(qb, page, pageSize);
    res.json(
      toEnvelope(
        items.map((article) => ({
          ...toPublicArticle(article),
          // The number the proposal rests on. Named for the decision rather than
          // for the column, because that is what a reviewer is reading it as.
          score: article.storyAssignmentScore,
          proposedStory: {
            id: article.story!.id,
            slug: article.story!.slug,
            title: article.story!.title,
            category: article.story!.category,
          },
        })),
        page,
        pageSize,
        total,
      ),
    );
  }),
);

// The decision. PATCH on the assignment rather than two command routes: accept and
// reject are one field's two values on one thing, and the thing being decided is
// identified by its Article — an Article has at most one Story Assignment
// (ADR-0026), so there is no assignment id to name.
clusteringRouter.patch(
  "/clustering/pending/:articleId",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const decision = (req.body ?? {}).decision as AssignmentDecision;
    if (!ASSIGNMENT_DECISIONS.includes(decision)) {
      res.status(422).json({ error: `decision must be one of: ${ASSIGNMENT_DECISIONS.join(", ")}` });
      return;
    }
    if (!isUuid(req.params.articleId)) {
      res.status(404).json({ error: "Pending assignment not found" });
      return;
    }

    // 404 covers three cases that are one thing to a reviewer: no such Article,
    // one that was never pending, and one another operator has already decided.
    // All three mean the row this decision was aimed at is not there to decide.
    const decided = await decidePendingAssignment(req.params.articleId, decision, req.user!.id);
    if (!decided) {
      res.status(404).json({ error: "Pending assignment not found" });
      return;
    }
    res.json(decided);
  }),
);
