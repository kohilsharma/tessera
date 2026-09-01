import { Router } from "express";
import { AppDataSource } from "../data-source";
import { enqueueEntityResolutionRun } from "../graph/queue";
import { MERGE_PROPOSAL_DECISIONS, decideMergeProposal, type MergeProposalDecision } from "../graph/merge";
import type { PromotableKind } from "../graph/config";
import { EntityMergeProposal } from "../entities/EntityMergeProposal";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { paginate, parseListQuery, toEnvelope } from "../lib/listQuery";
import { isUuid } from "../lib/uuid";

export const graphRouter = Router();

// ADR-0004: operating the pipeline is an Admin capability — a Student or Investor gets
// 403 here, and an anonymous caller 401 (requireAuth).
const adminOnly = [requireAuth, requireRole("admin")] as const;

// Enough reporting to recognise a name, not a page of it: three Articles per side answers
// "which stories is this the name from", which is the question a reviewer is actually
// deciding. Sampled rather than counted here — the counts are the ones the pass measured
// and stored on the proposal.
const PROPOSAL_SAMPLE_ARTICLES = 3;

type SampleArticle = { entityId: string; id: string; title: string; url: string; publishedAt: Date };

// The Articles behind each side, read from the citations rather than from the annotation
// window: `entity_edges` is a few thousand rows with both endpoint columns indexed, where
// the annotations it was derived from are millions. A node with no kept edges samples
// nothing, which is honest — its Article count still states what the pass counted.
async function sampleArticlesByEntity(entityIds: string[]): Promise<Map<string, SampleArticle[]>> {
  const samples = new Map<string, SampleArticle[]>();
  if (entityIds.length === 0) return samples;

  const rows = (await AppDataSource.query(
    `SELECT ranked."entityId", ranked."id", ranked."title", ranked."url", ranked."publishedAt"
       FROM (
         SELECT cite."entityId", a."id", a."title", a."url", a."publishedAt",
                ROW_NUMBER() OVER (PARTITION BY cite."entityId"
                                   ORDER BY a."publishedAt" DESC, a."id") AS "rank"
           FROM (
             SELECT "entityAId" AS "entityId", "articleId" FROM "entity_edges"
              WHERE "entityAId" = ANY($1::uuid[])
             UNION
             SELECT "entityBId", "articleId" FROM "entity_edges"
              WHERE "entityBId" = ANY($1::uuid[])
           ) cite
           JOIN "articles" a ON a."id" = cite."articleId"
       ) ranked
      WHERE ranked."rank" <= $2`,
    [entityIds, PROPOSAL_SAMPLE_ARTICLES],
  )) as SampleArticle[];

  for (const row of rows) {
    const existing = samples.get(row.entityId);
    if (existing) existing.push(row);
    else samples.set(row.entityId, [row]);
  }
  return samples;
}

// The trigger enqueues and the worker executes, exactly as ingestion's and
// clustering's do: the hourly scheduler feeds the same queue, so there is one
// execution path and what is demoed is what runs. History is read back from Postgres,
// never the queue, so the Admin console renders with the worker stopped.
//
// A collection POST with no id: a pass is one rebuild over every staged annotation, so
// there is nothing to name in the path. Pressing it twice while a pass is queued or in
// flight is a no-op (graph/queue.ts), so a second press is accepted and adds no second
// pass.
graphRouter.post(
  "/graph/resolution-runs",
  ...adminOnly,
  asyncHandler(async (_req, res) => {
    await enqueueEntityResolutionRun();
    res.status(202).json({ status: "accepted" });
  }),
);

// The merge review queue (#67), the same shape clustering's review queue established: a
// threshold with a band beneath it, decided by a human, remembered afterwards. Every row
// is a candidate the pass would not commit — both surface names, the kind they share, and
// the reporting behind each side, which is the whole of what a reviewer decides on.
//
// Sorted by similarity descending by default: the closest pairs are both the most likely
// merges and the ones a wrong decision costs most, so they are read first.
graphRouter.get(
  "/graph/merge-proposals",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const parsed = parseListQuery(req.query as Record<string, unknown>, {
      allowedSortBy: ["similarity"],
      defaultSortBy: "similarity",
    });
    if (!parsed.ok) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    const { page, pageSize, sortBy, sortDir } = parsed.value;

    const qb = AppDataSource.getRepository(EntityMergeProposal)
      .createQueryBuilder("proposal")
      // Inner joins: both foreign keys are NOT NULL and cascade, so a proposal without
      // its two Entities is not a row that exists.
      .innerJoinAndSelect("proposal.survivor", "survivor")
      .innerJoinAndSelect("proposal.merged", "merged")
      .orderBy(`proposal.${sortBy}`, sortDir === "asc" ? "ASC" : "DESC");

    const { items, total } = await paginate(qb, page, pageSize);
    const samples = await sampleArticlesByEntity(items.flatMap((p) => [p.survivorEntityId, p.mergedEntityId]));

    const side = (entity: { id: string; kind: PromotableKind; canonicalName: string }, articleCount: number) => ({
      id: entity.id,
      kind: entity.kind,
      // The surface form GDELT used, not the fold the similarity was measured over: a
      // reviewer decides between two names as they were reported.
      canonicalName: entity.canonicalName,
      articleCount,
      articles: (samples.get(entity.id) ?? []).map((a) => ({
        id: a.id,
        title: a.title,
        url: a.url,
        publishedAt: a.publishedAt,
      })),
    });

    res.json(
      toEnvelope(
        items.map((proposal) => ({
          id: proposal.id,
          similarity: proposal.similarity,
          // One kind, stated once: candidate pairs are same-kind by construction
          // (a cross-kind merge would fold `Ford` the company into `Ford` the person),
          // so two identical values would only invite the reader to compare them.
          kind: proposal.survivor.kind,
          survivor: side(proposal.survivor, proposal.survivorArticleCount),
          merged: side(proposal.merged, proposal.mergedArticleCount),
        })),
        page,
        pageSize,
        total,
      ),
    );
  }),
);

// The decision. PATCH on the proposal, as clustering's review does on its assignment:
// accept and refuse are one field's two values on one held row, and unlike the Story
// merge there is nothing for the caller to name — the pass fixed which name survives, so
// the orientation is not the Admin's to re-choose in the request.
graphRouter.patch(
  "/graph/merge-proposals/:proposalId",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const decision = (req.body ?? {}).decision as MergeProposalDecision;
    if (!MERGE_PROPOSAL_DECISIONS.includes(decision)) {
      res.status(422).json({ error: `decision must be one of: ${MERGE_PROPOSAL_DECISIONS.join(", ")}` });
      return;
    }
    if (!isUuid(req.params.proposalId)) {
      res.status(404).json({ error: "Merge proposal not found" });
      return;
    }

    // 404 covers three cases that are one thing to a reviewer: no such proposal, one
    // another operator has already decided, and one a pass rebuilt away because a name
    // left the working set. All three mean the row this decision was aimed at is gone.
    const decided = await decideMergeProposal(req.params.proposalId, decision, req.user!.id);
    if (!decided) {
      res.status(404).json({ error: "Merge proposal not found" });
      return;
    }
    res.json(decided);
  }),
);
