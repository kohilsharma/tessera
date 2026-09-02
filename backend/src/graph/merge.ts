import type { EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import type { PromotableKind } from "./config";

// One side of a merge, as both callers already hold it: the pass reads it from its
// candidate staging, the Admin route from the proposal's two Entities. `featureKey` is
// the coalesced form the alias and refusal tables store, not the nullable column.
export type MergeSide = {
  id: string;
  kind: PromotableKind;
  normalizedName: string;
  featureKey: string;
};

// CONTEXT.md "Refused merge" has a counterpart vocabulary here. `refuse` and not
// `reject`: a rejected pairing is clustering's word for a different decision about
// different rows, and using one word for both would make the two review queues look
// like one mechanism when only their shape is shared.
export const MERGE_PROPOSAL_DECISIONS = ["accept", "refuse"] as const;
export type MergeProposalDecision = (typeof MERGE_PROPOSAL_DECISIONS)[number];

// The key `entity_merge_refusals` stores an unordered pair under: the lesser normalized
// name in "A", which its CHECK enforces. One expression because two places have to agree
// on it — the insert below writes a refusal, and the pass reads the memory back to filter
// its candidates. If the two drifted the row would still be there and would silently stop
// matching the pair it was made about.
export const refusalKeySql = (one: string, other: string) =>
  [`LEAST(${one}, ${other})`, `GREATEST(${one}, ${other})`] as const;

export type DecidedMergeProposal = {
  proposalId: string;
  decision: MergeProposalDecision;
  survivorEntityId: string;
  mergedEntityId: string;
};

// Fold one Entity into another, carrying its citations. The same function serves the
// pass's automatic merges and an Admin's accept, which is the point: a merge above the
// bar and a merge a human agreed to are the same operation, so there is one place where
// what a merge *means* is written down.
//
// Takes a manager rather than opening its own transaction — the pass calls it inside the
// one transaction the whole rebuild runs in, and an accept inside its own.
export async function applyEntityMerge(
  manager: EntityManager,
  survivor: MergeSide,
  merged: MergeSide,
): Promise<void> {
  // Same kind and same FeatureID, checked rather than assumed. The pass only ever stages
  // same-kind pairs and an accept only ever names a pair the pass staged, so this cannot
  // fire today — but the alias below is keyed on the merged side while a refusal is keyed
  // on the survivor's, and nothing on `entity_merge_proposals` holds the two sides
  // together. A cross-kind pair would fold `Ford` the company into `Ford` the person, and
  // v3 §18.5 puts the wrong merge on the harmful side of that trade, so it stops here
  // rather than picking which side's key to trust.
  if (survivor.kind !== merged.kind || survivor.featureKey !== merged.featureKey) {
    throw new Error(
      `refusing a merge across kinds or FeatureIDs: ` +
        `${merged.kind}/${merged.featureKey || "—"} into ${survivor.kind}/${survivor.featureKey || "—"}`,
    );
  }

  // Remembered by name first, because this is the part that makes the merge last. Every
  // pass re-inserts each folded name it still finds above the promotion floor, so
  // deleting the row below without writing this would resurrect the merged name within
  // the hour — the merge would appear to work and silently undo itself.
  await manager.query(
    `INSERT INTO "entity_aliases" ("kind", "normalizedName", "featureKey", "targetNormalizedName")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("kind", "normalizedName", "featureKey")
     DO UPDATE SET "targetNormalizedName" = EXCLUDED."targetNormalizedName"`,
    [merged.kind, merged.normalizedName, merged.featureKey, survivor.normalizedName],
  );

  // Keep every stored target terminal: a name that folded into the one being merged away
  // now folds into the survivor. Without this, resolving a name would mean walking a
  // chain, and the fold — a single LEFT JOIN over millions of occurrences — would have to
  // become a recursive one. The self-exclusion is for the constraint, not for the logic:
  // a row may not point at itself.
  await manager.query(
    `UPDATE "entity_aliases" SET "targetNormalizedName" = $4
      WHERE "kind" = $1 AND "featureKey" = $3
        AND "targetNormalizedName" = $2 AND "normalizedName" <> $4`,
    [merged.kind, merged.normalizedName, merged.featureKey, survivor.normalizedName],
  );

  // The citation invariant is why this is an insert of rows and not an UPDATE of ids: an
  // edge is identified by its pair, so re-pointing one endpoint would collide with an
  // edge the survivor already has for the same Article. Each carried citation keeps the
  // Article that observed it, and ON CONFLICT DO NOTHING folds the overlap — one row per
  // (pair, Article), whichever side of the merge first reported it.
  //
  // LEAST/GREATEST because the stored pair is ordered by a CHECK, and the self-pair is
  // excluded: an Article naming both sides of the merge described one Entity naming
  // itself, which is not an edge.
  await manager.query(
    `INSERT INTO "entity_edges" ("entityAId", "entityBId", "articleId")
     SELECT LEAST($1::uuid, moved."other"), GREATEST($1::uuid, moved."other"), moved."articleId"
       FROM (
         SELECT CASE WHEN e."entityAId" = $2::uuid THEN e."entityBId" ELSE e."entityAId" END AS "other",
                e."articleId"
           FROM "entity_edges" e
          WHERE e."entityAId" = $2::uuid OR e."entityBId" = $2::uuid
       ) moved
      WHERE moved."other" <> $1::uuid
     ON CONFLICT DO NOTHING`,
    [survivor.id, merged.id],
  );

  // Deleted, not tombstoned: a merged-away Entity is a node the graph no longer has, and
  // a flag would be a row every reader surface had to learn to skip. Its leftover edges
  // and any proposal naming it go by cascade — including this one, on the Admin path,
  // which is why nothing here deletes the proposal by hand.
  await manager.query(`DELETE FROM "entities" WHERE "id" = $1`, [merged.id]);
}

// An Admin's decision on one held proposal. Returns null when there is nothing there to
// decide — no such proposal, or one another operator decided first, or one a pass
// rebuilt away — which the route answers as a 404, the same way the clustering review
// queue does.
export async function decideMergeProposal(
  proposalId: string,
  decision: MergeProposalDecision,
  decidedByUserId: string | null,
): Promise<DecidedMergeProposal | null> {
  return AppDataSource.transaction(async (manager) => {
    // The proposal row is locked first and alone, so two operators deciding the same
    // proposal queue rather than both acting on it.
    const [proposal] = (await manager.query(
      `SELECT "survivorEntityId", "mergedEntityId" FROM "entity_merge_proposals"
        WHERE "id" = $1 FOR UPDATE`,
      [proposalId],
    )) as { survivorEntityId: string; mergedEntityId: string }[];
    if (!proposal) return null;

    // Both Entities in id order, the order every writer here locks in, so a decision on
    // an overlapping pair waits instead of deadlocking. This is also what serializes a
    // decision against a pass, which rebuilds proposals inside its own transaction.
    const sides = (await manager.query(
      `SELECT "id", "kind", "normalizedName", COALESCE("featureId", '') AS "featureKey"
         FROM "entities" WHERE "id" = ANY($1::uuid[]) ORDER BY "id" FOR UPDATE`,
      [[proposal.survivorEntityId, proposal.mergedEntityId]],
    )) as MergeSide[];
    const survivor = sides.find((side) => side.id === proposal.survivorEntityId);
    const merged = sides.find((side) => side.id === proposal.mergedEntityId);
    if (!survivor || !merged) return null;

    if (decision === "refuse") {
      // Keyed on the names and nothing else, so it outlives both Entities: the pair may
      // fall below the floor, be demoted, and be promoted again next month under fresh
      // ids, and this judgement still holds. ON CONFLICT DO NOTHING because refusing an
      // already-refused pair is the same answer, not a second one — the earlier refusal
      // and its author stand.
      const [nameA, nameB] = refusalKeySql("$3", "$4");
      await manager.query(
        `INSERT INTO "entity_merge_refusals"
           ("kind", "featureKey", "normalizedNameA", "normalizedNameB", "refusedByUserId")
         VALUES ($1, $2, ${nameA}, ${nameB}, $5)
         ON CONFLICT DO NOTHING`,
        [survivor.kind, survivor.featureKey, survivor.normalizedName, merged.normalizedName, decidedByUserId],
      );
      // Both Entities stand and keep their edges; only the proposal goes. The refusal is
      // what stops the next pass making it again.
      await manager.query(`DELETE FROM "entity_merge_proposals" WHERE "id" = $1`, [proposalId]);
    } else {
      await applyEntityMerge(manager, survivor, merged);
    }

    return { proposalId, decision, survivorEntityId: survivor.id, mergedEntityId: merged.id };
  });
}
