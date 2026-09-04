import { AppDataSource } from "../data-source";
import { PENDING_ASSIGNMENT, acceptedCentroid, acceptedMembership } from "../lib/storyMembership";
import { invalidateComparableStoriesCache } from "../generation/evidence";
import type { MergedArticleSnapshot, MergedStorySnapshot, RejectedAssignmentSnapshot } from "../entities/StoryMergeRecord";
import { RejectedStoryAssignment } from "../entities/RejectedStoryAssignment";

// #52: the correction ADR-0026's deliberately tight threshold makes necessary. The
// job errs towards two Stories rather than one wrong Story, so the operator surface
// has to be able to say "these are one event" — and the refusals are the interesting
// part, because a merge deletes a row that Articles point at.
export type StoryMergeRefusal = "not_found" | "same_story" | "curated";

export type StoryMergeResult =
  | { status: "merged"; survivorStoryId: string; mergedStoryId: string; movedArticles: number }
  | { status: "refused"; reason: StoryMergeRefusal };

export type StoryUnmergeResult =
  | { status: "unmerged"; survivorStoryId: string; restoredStoryId: string; restoredArticles: number }
  | { status: "refused"; reason: "not_found" | "already_changed" };

export async function mergeStories(survivorStoryId: string, mergedStoryId: string): Promise<StoryMergeResult> {
  // Guarded here rather than only in the route: "merge a Story into itself" would
  // move its Articles onto the row about to be deleted, and articles."storyId"
  // cascades — a self-merge is a request to delete a Story's reporting.
  if (survivorStoryId === mergedStoryId) return { status: "refused", reason: "same_story" };

  const result: StoryMergeResult = await AppDataSource.transaction(async (manager) => {
    // Every membership writer locks Articles before its Story, with overlapping
    // Article sets ordered by id. Review and clustering use the same order, so a
    // merge waits behind an in-flight decision instead of each holding the row the
    // other needs.
    await manager.query(
      `SELECT "id" FROM "articles" WHERE "storyId" = ANY($1::uuid[]) ORDER BY "id" FOR UPDATE`,
      [[survivorStoryId, mergedStoryId]],
    );

    // Both Story rows also lock in id order so two operators merging the same pair
    // in opposite directions queue instead of deadlocking.
    const locked: { id: string }[] = await manager.query(
      `SELECT "id" FROM "stories" WHERE "id" = ANY($1::uuid[]) ORDER BY "id" FOR UPDATE`,
      [[survivorStoryId, mergedStoryId]],
    );
    if (locked.length !== 2) return { status: "refused", reason: "not_found" };

    // ADR-0026 closes the Curated Corpus in both directions — clustering never puts
    // a live Article into it or takes one out — and a merge by hand is the same
    // move. `manual_fixture` is what makes a Story curated (ADR-0007), so it is what
    // is tested, on both sides. Derived from the membership rather than from a flag
    // on the Story: there is no such flag, and an empty curated Story is not a thing
    // the seed can produce.
    const curated: { storyId: string }[] = await manager.query(
      `SELECT DISTINCT "storyId" FROM "articles"
       WHERE "storyId" = ANY($1::uuid[]) AND "analysisTextMode" = 'manual_fixture'`,
      [[survivorStoryId, mergedStoryId]],
    );
    if (curated.length > 0) return { status: "refused", reason: "curated" };

    const mergedRows: MergedStorySnapshot[] = await manager.query(
      `SELECT "id", "slug", "title", "summary", "category", "firstSeenAt", "lastSeenAt", "clusteringRunId"
       FROM "stories" WHERE "id" = $1`,
      [mergedStoryId],
    );
    const articleSnapshots: MergedArticleSnapshot[] = await manager.query(
      `SELECT "id", "storyAssignmentStatus", "storyAssignmentScore"
       FROM "articles" WHERE "storyId" = $1`,
      [mergedStoryId],
    );
    const rejectedSnapshots: RejectedAssignmentSnapshot[] = await manager.query(
      `SELECT "articleId", "rejectedByUserId", "rejectedAt" FROM "rejected_story_assignments" WHERE "storyId" = $1`,
      [mergedStoryId],
    );
    const evidenceRows: { id: string }[] = await manager.query(
      `SELECT "id" FROM "evidence_sets" WHERE "storyId" = $1`,
      [mergedStoryId],
    );
    const generationRows: { id: string }[] = await manager.query(
      `SELECT "id" FROM "generation_runs" WHERE "storyId" = $1`,
      [mergedStoryId],
    );
    await manager.query(
      `INSERT INTO "story_merge_records" ("survivorStoryId", "mergedStoryId", "mergedStory", "articles", "rejectedAssignments", "evidenceSetIds", "generationRunIds")
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::uuid[], $7::uuid[])`,
      [
        survivorStoryId,
        mergedStoryId,
        JSON.stringify(mergedRows[0]),
        JSON.stringify(articleSnapshots),
        JSON.stringify(rejectedSnapshots),
        evidenceRows.map(({ id }) => id),
        generationRows.map(({ id }) => id),
      ],
    );

    // Every Article, decision and score intact: an accepted member becomes a member
    // of the survivor, and a proposal becomes a proposal *for* the survivor, still
    // awaiting the Admin who has not decided it. A merge corrects the Stories, not
    // the judgements about the Articles — and it never touches what cites them,
    // because a Brief and an EvidenceSet pin Articles, not Stories.
    const [, movedArticles]: [unknown[], number] = await manager.query(
      `UPDATE "articles" SET "storyId" = $1 WHERE "storyId" = $2`,
      [survivorStoryId, mergedStoryId],
    );

    // Recomputed from the membership the survivor has now rather than widened by
    // what arrived: the same definition a run uses, so a merge cannot leave a Story
    // stating a mean or a span no member supports. Accepted members only, so a
    // proposal that moved with the rest still moves nothing (#50). COALESCE because
    // both span columns are NOT NULL and a Story can, in principle, hold no
    // accepted member — leave the old span rather than fail the merge.
    const acceptedSpan = (aggregate: "min" | "max") =>
      `(SELECT ${aggregate}(a."publishedAt") FROM "articles" a
        WHERE a."storyId" = s."id" AND ${acceptedMembership("a")})`;
    await manager.query(
      `UPDATE "stories" s
       SET "firstSeenAt" = COALESCE(${acceptedSpan("min")}, s."firstSeenAt"),
           "lastSeenAt" = COALESCE(${acceptedSpan("max")}, s."lastSeenAt"),
           "embedding" = ${acceptedCentroid("s")}
       WHERE s."id" = $1`,
      [survivorStoryId],
    );

    // ADR-0026's centroid over the merged membership, and then the proposals rescored
    // against it. A moved proposal's score was measured against a Story that no
    // longer exists, and #50's rule is that a score describing something other than
    // what it is shown beside is not a judgement anyone should be seeing: the review
    // queue states it and sorts by it. Nothing else would fix it — a run's candidates
    // are Unclustered Articles, so a proposal is never rescored by the job.
    //
    // NULL propagates through `<=>`, which is the honest answer where there is
    // nothing to compare: an Article whose vector enrichment has cleared, or a
    // survivor with no accepted member left, leaves the proposal unscored rather
    // than carrying a number about a deleted Story. It stays pending either way — a
    // merge decides nothing about the Articles (#52).
    await manager.query(
      `UPDATE "articles" a
       SET "storyAssignmentScore" = 1 - (a."embedding" <=> s."embedding")
       FROM "stories" s
       WHERE s."id" = $1 AND a."storyId" = $1 AND a."storyAssignmentStatus" = $2`,
      [survivorStoryId, PENDING_ASSIGNMENT],
    );

    // #55: a Brief pins a GenerationRun, and both `generation_runs."storyId"` and
    // `evidence_sets."storyId"` are ON DELETE CASCADE — so deleting the emptied row
    // below would take a reader's saved analysis with it, claims and frozen evidence
    // and all. Repointed instead: a merge is the judgement that these two Stories are
    // one event, so an analysis of the folded-in Story is an analysis of the survivor.
    // Reuse is unaffected — it matches on the evidence hash, and the survivor's
    // membership now produces a different set.
    await manager.query(`UPDATE "evidence_sets" SET "storyId" = $1 WHERE "storyId" = $2`, [
      survivorStoryId,
      mergedStoryId,
    ]);
    await manager.query(`UPDATE "generation_runs" SET "storyId" = $1 WHERE "storyId" = $2`, [
      survivorStoryId,
      mergedStoryId,
    ]);

    // Deleted rather than marked (#52): a tombstoned Story is a row every reader
    // surface would have to learn to skip. Checked first because articles."storyId"
    // is ON DELETE CASCADE — anything still pointing here would be deleted with it,
    // so a leftover row rolls the merge back instead of quietly destroying
    // reporting.
    const [{ leftover }]: { leftover: number }[] = await manager.query(
      `SELECT count(*)::int AS leftover FROM "articles" WHERE "storyId" = $1`,
      [mergedStoryId],
    );
    if (leftover !== 0) {
      throw new Error(`Refusing to delete Story ${mergedStoryId}: ${leftover} Article(s) still reference it`);
    }
    await manager.query(`DELETE FROM "stories" WHERE "id" = $1`, [mergedStoryId]);

    // Two things a merge deliberately does not do to `rejected_story_assignments`.
    // It does not consult it: an Article an Admin once refused for the survivor can
    // arrive as a member of the Story being folded in, and that is right — the merge
    // is the newer human judgement, and it says these are one event. The stale row is
    // inert, because a run only ever filters candidates, which are Unclustered
    // Articles.
    //
    // ponytail: nor does it carry rows over. A pairing refused for the emptied Story
    // is cascade-deleted with it, so that proposal can be made once more against the
    // survivor; the reviewer refuses it again and it stays refused. Copy the rows
    // across only if that second refusal turns out to be a real cost.
    return { status: "merged", survivorStoryId, mergedStoryId, movedArticles };
  });
  if (result.status === "merged") await invalidateComparableStoriesCache();
  return result;
}

export async function unmergeStory(mergeId: string): Promise<StoryUnmergeResult> {
  const result = await AppDataSource.transaction(async (manager) => {
    const records: {
      id: string;
      survivorStoryId: string;
      mergedStoryId: string;
      mergedStory: MergedStorySnapshot;
      articles: MergedArticleSnapshot[];
      rejectedAssignments: RejectedAssignmentSnapshot[];
      evidenceSetIds: string[];
      generationRunIds: string[];
    }[] = await manager.query(
      `SELECT "id", "survivorStoryId", "mergedStoryId", "mergedStory", "articles", "rejectedAssignments", "evidenceSetIds", "generationRunIds"
       FROM "story_merge_records" WHERE "id" = $1 FOR UPDATE`,
      [mergeId],
    );
    const record = records[0];
    if (!record) return { status: "refused", reason: "not_found" } as const;

    const currentArticles: { id: string }[] = record.articles.length
      ? await manager.query(
          `SELECT "id" FROM "articles" WHERE "id" = ANY($1::uuid[]) AND "storyId" = $2`,
          [record.articles.map(({ id }) => id), record.survivorStoryId],
        )
      : [];
    if (currentArticles.length !== record.articles.length) {
      return { status: "refused", reason: "already_changed" } as const;
    }
    const survivor = await manager.query(`SELECT "id" FROM "stories" WHERE "id" = $1 FOR UPDATE`, [record.survivorStoryId]);
    if (!survivor.length) return { status: "refused", reason: "not_found" } as const;

    await manager.query(
      `INSERT INTO "stories" ("id", "slug", "title", "summary", "category", "firstSeenAt", "lastSeenAt", "clusteringRunId")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.mergedStory.id,
        record.mergedStory.slug,
        record.mergedStory.title,
        record.mergedStory.summary,
        record.mergedStory.category,
        record.mergedStory.firstSeenAt,
        record.mergedStory.lastSeenAt,
        record.mergedStory.clusteringRunId,
      ],
    );
    for (const article of record.articles) {
      await manager.query(
        `UPDATE "articles" SET "storyId" = $1, "storyAssignmentStatus" = $2, "storyAssignmentScore" = $3 WHERE "id" = $4`,
        [record.mergedStoryId, article.storyAssignmentStatus, article.storyAssignmentScore, article.id],
      );
    }
    for (const rejection of record.rejectedAssignments) {
      await manager.getRepository(RejectedStoryAssignment).save({
        articleId: rejection.articleId,
        storyId: record.mergedStoryId,
        rejectedByUserId: rejection.rejectedByUserId,
        rejectedAt: rejection.rejectedAt,
      });
    }
    if (record.evidenceSetIds.length) {
      await manager.query(`UPDATE "evidence_sets" SET "storyId" = $1 WHERE "id" = ANY($2::uuid[])`, [record.mergedStoryId, record.evidenceSetIds]);
    }
    if (record.generationRunIds.length) {
      await manager.query(`UPDATE "generation_runs" SET "storyId" = $1 WHERE "id" = ANY($2::uuid[])`, [record.mergedStoryId, record.generationRunIds]);
    }
    await manager.query(`UPDATE "stories" SET "embedding" = ${acceptedCentroid("stories")}, "firstSeenAt" = COALESCE((SELECT min("publishedAt") FROM "articles" WHERE "storyId" = $1 AND ${acceptedMembership("articles")}), "firstSeenAt"), "lastSeenAt" = COALESCE((SELECT max("publishedAt") FROM "articles" WHERE "storyId" = $1 AND ${acceptedMembership("articles")}), "lastSeenAt") WHERE "id" = $1`, [record.mergedStoryId]);
    await manager.query(`UPDATE "stories" SET "embedding" = ${acceptedCentroid("stories")} WHERE "id" = $1`, [record.survivorStoryId]);
    await manager.query(`DELETE FROM "story_merge_records" WHERE "id" = $1`, [mergeId]);
    return { status: "unmerged", survivorStoryId: record.survivorStoryId, restoredStoryId: record.mergedStoryId, restoredArticles: record.articles.length } as const;
  });
  if (result.status === "unmerged") await invalidateComparableStoriesCache();
  return result;
}
