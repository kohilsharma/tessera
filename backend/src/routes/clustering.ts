import { Router } from "express";
import { AppDataSource } from "../data-source";
import { enqueueClusteringRun } from "../clustering/queue";
import { mergeStories, unmergeStory, type StoryMergeRefusal } from "../clustering/merge";
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

// What a refused merge (#52) tells the operator. `not_found` is not here: it is the
// one refusal that is not a 422, and it is answered where the status is chosen.
const MERGE_REFUSALS: Record<Exclude<StoryMergeRefusal, "not_found">, string> = {
  same_story: "A Story cannot be merged into itself",
  curated: "A Story in the Curated Corpus cannot be merged",
};

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

clusteringRouter.post(
  "/clustering/merges/:mergeId/unmerge",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.mergeId)) {
      res.status(404).json({ error: "Story merge not found" });
      return;
    }
    const result = await unmergeStory(req.params.mergeId);
    if (result.status === "unmerged") {
      res.json(result);
      return;
    }
    res.status(result.reason === "not_found" ? 404 : 422).json({
      error: result.reason === "not_found" ? "Story merge not found" : "This Story merge can no longer be reversed",
    });
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

// The merge (#52), and the one command on this surface that is not an enqueue: it
// is a correction to two named rows an operator is looking at, so it is done in the
// request and answered with what it did. Nothing about it is expensive — no model
// call, no embedding, one transaction — so a queue would only make the console lie
// about when the Stories became one.
//
// A collection POST rather than a PATCH on either Story: the survivor and the
// emptied Story are both changed, and one of them stops existing.
clusteringRouter.post(
  "/clustering/merges",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const { survivorStoryId, mergedStoryId } = (req.body ?? {}) as Record<string, unknown>;
    if (!isUuid(survivorStoryId) || !isUuid(mergedStoryId)) {
      res.status(422).json({ error: "survivorStoryId and mergedStoryId must both be Story ids" });
      return;
    }

    const merged = await mergeStories(survivorStoryId, mergedStoryId);
    if (merged.status === "merged") {
      res.json({
        survivorStoryId: merged.survivorStoryId,
        mergedStoryId: merged.mergedStoryId,
        movedArticles: merged.movedArticles,
      });
      return;
    }
    // Each refusal answers the question the operator actually asked. A missing Story
    // is a 404 because the pair named does not exist to merge; the other two are
    // refusals of a merge that does exist and would be wrong. A map rather than a
    // ternary, and `Exclude` rather than `Partial` (as ANALYSIS_TEXT_MODE_RANK does):
    // a fourth refusal reason fails to compile until it is given its own wording.
    if (merged.reason === "not_found") {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    res.status(422).json({ error: MERGE_REFUSALS[merged.reason] });
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
