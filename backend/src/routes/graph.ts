import { Router } from "express";
import { AppDataSource } from "../data-source";
import { GDELT_RETENTION_DAYS } from "../ingestion/retention";
import { enqueueEntityResolutionRun } from "../graph/queue";
import {
  loadEdgeCitations,
  loadEntityNeighbourhood,
  loadGraphView,
  loadProposalCitations,
} from "../graph/loadGraphView";
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

// The reader's graph (#68). `requireAuth` and no role guard: ADR-0021 gives each role its
// own *features*, and this is not one — a Student and an Investor read the same graph,
// because a co-occurrence the two roles were shown differently would be evidence about
// the reader rather than about the reporting.
//
// No query string, by design. The bounds this view is legible under belong to
// graph/config.ts, and an endpoint that names none of them is an endpoint whose bounds a
// caller cannot widen. Anything sent is ignored rather than rejected: a bound is not a
// parameter, so `?nodes=5000` is not a malformed request, it is a request about nothing.
graphRouter.get(
  "/graph",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await loadGraphView());
  }),
);

// The one parameter either graph route accepts, and the reason it is safe to: a Theme only
// ever narrows (ADR-0028 — never a node, always a facet). Anything unusable falls back to
// the unfaceted picture rather than 422ing, for the same reason `GET /graph` ignores
// `?nodes=5000`: a reader following a stale link is owed the page, not a validation error.
function themeOf(query: Record<string, unknown>): string | null {
  const theme = query.theme;
  return typeof theme === "string" && theme.trim() !== "" ? theme : null;
}

// One Entity's neighbourhood (#69), reached by clicking a name in the global view. Same
// `requireAuth` and no role guard, for the reason above — and the same read path, so the
// bounds and the promotion floor here are the ones the global view applied and the two
// pictures cannot disagree about what is in the graph.
//
// 404 for an id that is not a uuid as well as for one the graph does not hold: a name a
// merge folded away or a pass demoted is a name that is gone, and both arrive here as a
// link that no longer resolves. Checked before the query so a malformed id is not a
// database error.
graphRouter.get(
  "/graph/entities/:entityId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const view = isUuid(req.params.entityId)
      ? await loadEntityNeighbourhood(req.params.entityId, themeOf(req.query as Record<string, unknown>))
      : null;
    if (!view) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    res.json(view);
  }),
);

// The evidence under one edge: the Articles the co-mention was observed in, which is the
// citation invariant made openable. A pair the graph holds no edge for is 404 rather than
// an empty list — an empty list would assert a co-mention that was never reported.
graphRouter.get(
  "/graph/entities/:entityId/edges/:otherEntityId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { entityId, otherEntityId } = req.params;
    const evidence =
      isUuid(entityId) && isUuid(otherEntityId)
        ? await loadEdgeCitations(entityId, otherEntityId, themeOf(req.query as Record<string, unknown>))
        : null;
    if (!evidence) {
      res.status(404).json({ error: "Edge not found" });
      return;
    }
    res.json(evidence);
  }),
);

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
    // Through the graph's read seam, like every other firehose read: AGENTS.md's
    // membership invariant exempts `loadGraphView.ts`, not a route asking the same
    // question in a query of its own. It labels each citation with the Story a reader
    // could open it as, which is what lets the queue link in where there is one.
    const samples = await loadProposalCitations(items.flatMap((p) => [p.survivorEntityId, p.mergedEntityId]));

    const side = (entity: { id: string; kind: PromotableKind; canonicalName: string }, articleCount: number) => ({
      id: entity.id,
      kind: entity.kind,
      // The surface form GDELT used, not the fold the similarity was measured over: a
      // reviewer decides between two names as they were reported.
      canonicalName: entity.canonicalName,
      articleCount,
      articles: (samples.get(entity.id) ?? []).map(({ entityId: _entityId, ...citation }) => citation),
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
        // The corpus this queue reads, on the surface that draws it: the exemption
        // AGENTS.md grants the graph seam is granted on that condition, and a reviewer
        // deciding a fold is reading firehose reporting rather than the Curated Corpus
        // alone. Sent rather than restated in the console, so the Admin surface states
        // the number the two reader surfaces state (../graph/loadGraphView.ts).
        { retainedDays: GDELT_RETENTION_DAYS },
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
