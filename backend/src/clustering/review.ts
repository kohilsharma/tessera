import { AppDataSource } from "../data-source";
import { ACCEPTED_ASSIGNMENT, PENDING_ASSIGNMENT, acceptedCentroid } from "../lib/storyMembership";

export const ASSIGNMENT_DECISIONS = ["accept", "reject"] as const;
export type AssignmentDecision = (typeof ASSIGNMENT_DECISIONS)[number];

export type DecidedAssignment = { articleId: string; storyId: string; decision: AssignmentDecision };

// The Admin half of ADR-0026's review band: what a person does with a proposal the
// job would not commit on its own. Null means there was no pending assignment to
// decide — a wrong id, or a decision that lost a race with another operator's.
//
// A transaction rather than two updates, locking every Article already assigned
// to the Story in id order before anything locks the Story itself. Clustering and
// merge use that same order: accepting changes a centroid, and so does an
// assignment in a concurrent run, so the writers must serialise or one commits
// against a mean the other has already moved.
export async function decidePendingAssignment(
  articleId: string,
  decision: AssignmentDecision,
  decidedByUserId: string,
): Promise<DecidedAssignment | null> {
  return AppDataSource.transaction(async (manager) => {
    const proposed: { storyId: string }[] = await manager.query(
      `SELECT "storyId" FROM "articles" WHERE "id" = $1 AND "storyAssignmentStatus" = $2`,
      [articleId, PENDING_ASSIGNMENT],
    );
    if (proposed.length === 0) return null;
    const { storyId } = proposed[0];

    // Every membership writer locks overlapping Article sets in id order before
    // locking their Story. Revalidate the proposal after waiting: a concurrent
    // merge may have moved it while this transaction was between the two reads.
    const members: { id: string; storyAssignmentStatus: string }[] = await manager.query(
      `SELECT "id", "storyAssignmentStatus" FROM "articles"
       WHERE "storyId" = $1 ORDER BY "id" FOR UPDATE`,
      [storyId],
    );
    if (!members.some((member) => member.id === articleId && member.storyAssignmentStatus === PENDING_ASSIGNMENT)) {
      return null;
    }

    if (decision === "reject") {
      // Remembered before the membership is cleared: the pairing is what later runs
      // must not re-propose, and the next statement is what erases the only record
      // of which Story it was proposed for.
      await manager.query(
        `INSERT INTO "rejected_story_assignments" ("articleId", "storyId", "rejectedByUserId")
         VALUES ($1, $2, $3) ON CONFLICT ("articleId", "storyId") DO NOTHING`,
        [articleId, storyId, decidedByUserId],
      );
      // Back to Unclustered, decision and score cleared with it: an Unclustered
      // Article carries neither (ADR-0026), and a leftover score would read as a
      // membership that had been scored rather than one that was refused.
      await manager.query(
        `UPDATE "articles" SET "storyId" = NULL, "storyAssignmentStatus" = NULL, "storyAssignmentScore" = NULL
         WHERE "id" = $1`,
        [articleId],
      );
      return { articleId, storyId, decision };
    }

    // The score stays as the run wrote it: it records what produced this
    // membership, and an Admin accepting a 0.8 has not made it a 1.
    await manager.query(`UPDATE "articles" SET "storyAssignmentStatus" = $2 WHERE "id" = $1`, [
      articleId,
      ACCEPTED_ASSIGNMENT,
    ]);
    // Now that it counts as a member it belongs in both of the Story's derived
    // facts: the centroid the next run scores candidates against, and the span the
    // recency gate and browse both read.
    await manager.query(
      `UPDATE "stories" s
       SET "firstSeenAt" = LEAST(s."firstSeenAt", a."publishedAt"),
           "lastSeenAt" = GREATEST(s."lastSeenAt", a."publishedAt"),
           "embedding" = ${acceptedCentroid("s")}
       FROM "articles" a
       WHERE s."id" = $1 AND a."id" = $2`,
      [storyId, articleId],
    );
    return { articleId, storyId, decision };
  });
}
