import type { EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { EntityResolutionRun } from "../entities/EntityResolutionRun";
import {
  EDGES_PER_ENTITY,
  ENTITY_MERGE_AUTO_SIMILARITY,
  ENTITY_MERGE_REVIEW_SIMILARITY,
  ENTITY_PROMOTION_FLOOR,
  PROMOTABLE_KINDS,
  type PromotableKind,
} from "./config";
import { bothEndsBoundSql } from "./edgeBound";
import { applyEntityMerge, refusalKeySql } from "./merge";

// The fold identity is decided on: case, punctuation and whitespace. One SQL
// expression rather than a TypeScript function, because the retained window holds
// millions of occurrences and grouping them in the process would mean streaming the
// whole firehose through Node to count names Postgres can count in place. Exported
// because #67's trigram candidate generation has to search the same fold that
// promotion wrote, or it would propose merges between names already merged.
//
// `[:alnum:]` and not `a-z0-9`: the latter folds `José` to `jos` and `Jose` to `jose`,
// inventing the very duplicate the fold exists to remove. Punctuation folds to a
// separator rather than away, so `Jean-Luc` and `Jean Luc` are one name — the variance
// GDELT's own extraction actually produces. An initialism written both `I.B.M.` and
// `IBM` therefore stays two names, which is #67's business: a judgement call about
// which spellings are the same name belongs with the fuzzy matcher and its review
// queue, not in a fold that cannot be reviewed.
export const normalizedNameSql = (column: string) =>
  `btrim(regexp_replace(lower(${column}), '[^[:alnum:]]+', ' ', 'g'))`;

// A location's identity includes GKG's gazetteer id; the other kinds have none. '' and
// not NULL inside the pass because NULL never equals NULL, so a GROUP BY or a join on
// a nullable id would split one name into a row per occurrence. Re-nullified with
// NULLIF on the way into `entities`, so the stored column means "no FeatureID".
//
// The consequence of that coalesce: two same-named places that both arrived *without* a
// FeatureID are one Entity, since there is nothing left to tell them apart. GKG's location
// block carries a FeatureID on every occurrence, so this is the fixture corpus's case, not
// the firehose's.
const featureKeySql = `COALESCE(CASE WHEN ga."kind" = 'location' THEN ga."locationDetail" ->> 'featureId' END, '')`;

// The merge memory, read into the fold: a name that has been merged away resolves to the
// name it folds into, everywhere the pass decides identity (#67). One LEFT JOIN and not a
// recursive walk, because every stored target is terminal — see ../entities/EntityAlias.
//
// This is what makes a merge outlast the pass that made it. Applied in *both* places
// identity is decided: in the candidate staging, so the merged name is never a candidate
// and never promotes again, and in the mention staging, so its occurrences count towards
// the survivor's edges rather than falling out of the graph.
const aliasJoinSql = `LEFT JOIN "entity_aliases" al
         ON al."kind" = ga."kind"
        AND al."normalizedName" = ${normalizedNameSql('ga."surfaceName"')}
        AND al."featureKey" = ${featureKeySql}`;

const resolvedNameSql = `COALESCE(al."targetNormalizedName", ${normalizedNameSql('ga."surfaceName"')})`;

// Is this pair one an Admin has already refused? Read through the same aliases the fold
// reads, because the names a refusal was made about can themselves be merged away
// afterwards: refuse `securities and exchange` against `securities and exchange
// commission`, let the second fold into the typo `…commision`, and the pair that is left
// names the same two things the Admin looked at. A refusal keyed on raw names goes quiet
// there — the memory still holds the row and stops matching the pair it was made about.
//
// Both stored names are resolved and the pair re-ordered afterwards, since a fold can move
// which of the two is the lesser.
const refusedPairSql = (kind: string, featureKey: string, one: string, other: string) => {
  const [nameA, nameB] = refusalKeySql(one, other);
  const [refusedA, refusedB] = refusalKeySql(
    `COALESCE(ra."targetNormalizedName", r."normalizedNameA")`,
    `COALESCE(rb."targetNormalizedName", r."normalizedNameB")`,
  );
  return `EXISTS (
          SELECT 1 FROM "entity_merge_refusals" r
            LEFT JOIN "entity_aliases" ra
                   ON ra."kind" = r."kind" AND ra."featureKey" = r."featureKey"
                  AND ra."normalizedName" = r."normalizedNameA"
            LEFT JOIN "entity_aliases" rb
                   ON rb."kind" = r."kind" AND rb."featureKey" = r."featureKey"
                  AND rb."normalizedName" = r."normalizedNameB"
           WHERE r."kind" = ${kind} AND r."featureKey" = ${featureKey}
             AND ${refusedA} = ${nameA} AND ${refusedB} = ${nameB}
        )`;
};

type Counted = { count: number };

// Every promotable occurrence, folded and grouped into the candidate names a floor can
// be applied to, with the surface form each will be displayed under. A temp table and
// not a CTE chain repeated per query: this is the pass's one expensive read, and the
// count, the promotion and the demotion all need the same answer to agree.
async function stageCandidates(manager: EntityManager): Promise<void> {
  await manager.query(
    `CREATE TEMP TABLE "resolution_candidate" ON COMMIT DROP AS
     WITH folded AS (
       SELECT ga."kind",
              ${resolvedNameSql} AS "normalizedName",
              ${featureKeySql} AS "featureKey",
              ga."surfaceName",
              ga."articleId"
         FROM "gkg_annotations" ga
         ${aliasJoinSql}
        WHERE ga."kind" = ANY($1::varchar[])
     ),
     named AS (SELECT * FROM folded WHERE "normalizedName" <> ''),
     grouped AS (
       SELECT "kind", "normalizedName", "featureKey", COUNT(DISTINCT "articleId")::int AS "articleCount"
         FROM named GROUP BY 1, 2, 3
     ),
     canonical AS (
       SELECT "kind", "normalizedName", "featureKey", "surfaceName",
              ROW_NUMBER() OVER (PARTITION BY "kind", "normalizedName", "featureKey"
                                 ORDER BY COUNT(*) DESC, "surfaceName" ASC) AS "rank"
         FROM named GROUP BY 1, 2, 3, 4
     )
     SELECT g."kind", g."normalizedName", g."featureKey", g."articleCount",
            c."surfaceName" AS "canonicalName"
       FROM grouped g
       JOIN canonical c USING ("kind", "normalizedName", "featureKey")
      WHERE c."rank" = 1`,
    [PROMOTABLE_KINDS],
  );
}

// What the pass read, before the floor decided anything about it. Counted first so a
// run that fails later still states the size of the input it failed on.
async function readCounts(manager: EntityManager): Promise<{ annotations: number; articles: number }> {
  const [row] = (await manager.query(
    `SELECT COUNT(*)::int AS annotations, COUNT(DISTINCT "articleId")::int AS articles
       FROM "gkg_annotations" WHERE "kind" = ANY($1::varchar[])`,
    [PROMOTABLE_KINDS],
  )) as { annotations: number; articles: number }[];
  return row;
}

// ON CONFLICT rather than delete-and-reinsert, so an Entity that stays promoted keeps
// its id across passes: #67's merge refusals and #69's read paths reference these, and
// an id that changed hourly would break both. The canonical name is refreshed because
// the most frequent surface form can move as the window rolls.
async function promote(manager: EntityManager): Promise<void> {
  await manager.query(
    `INSERT INTO "entities" ("kind", "canonicalName", "normalizedName", "featureId")
     SELECT "kind", "canonicalName", "normalizedName", NULLIF("featureKey", '')
       FROM "resolution_candidate" WHERE "articleCount" >= $1
     ON CONFLICT ("kind", "normalizedName", (COALESCE("featureId", '')))
     DO UPDATE SET "canonicalName" = EXCLUDED."canonicalName"`,
    [ENTITY_PROMOTION_FLOOR],
  );
}

// An Entity whose annotations have aged out of the retained window leaves the working
// set — the graph is rolling (ADR-0028), so a node nothing cites any more is not a node.
// Its edges go with it by cascade; the citation invariant does not depend on that,
// because the rebuild below writes every edge from scratch anyway.
async function demote(manager: EntityManager): Promise<number> {
  const result = (await manager.query(
    `DELETE FROM "entities" e
      WHERE NOT EXISTS (
        SELECT 1 FROM "resolution_candidate" c
         WHERE c."kind" = e."kind"
           AND c."normalizedName" = e."normalizedName"
           AND c."featureKey" = COALESCE(e."featureId", '')
           AND c."articleCount" >= $1
      )`,
    [ENTITY_PROMOTION_FLOOR],
  )) as [unknown[], number];
  return result[1];
}

// Which Entity each Article names, by joining the annotations back through the same
// fold that promoted them. A second read of the annotation table rather than carrying
// the occurrences forward from `stageCandidates`, because only promoted names matter
// here and the join is against a few hundred rows.
async function stageMentions(manager: EntityManager): Promise<void> {
  await manager.query(
    `CREATE TEMP TABLE "resolution_mention" ON COMMIT DROP AS
     SELECT DISTINCT ga."articleId", e."id" AS "entityId"
       FROM "gkg_annotations" ga
       ${aliasJoinSql}
       JOIN "entities" e
         ON e."kind" = ga."kind"
        AND e."normalizedName" = ${resolvedNameSql}
        AND COALESCE(e."featureId", '') = ${featureKeySql}
      WHERE ga."kind" = ANY($1::varchar[])`,
    [PROMOTABLE_KINDS],
  );
}

// Names that look like each other, above the review floor, oriented and filtered down to
// the pairs still open to a decision (#67). Staged rather than returned because both the
// automatic merges and the proposals read the same answer, and the second must see what
// the first did.
//
// Pairs are same-kind and same-FeatureID only. Cross-kind mistyping — `Los Angeles`
// reported as a person — is what the promotion floor already removes, and merging across
// kinds would fold `Ford` the company into `Ford` the person on a perfect name match. Two
// same-named places are two nodes by design, so their gazetteer ids have to agree too.
//
// `similarity(a, b) >= $1` and not the `%` operator: `%` reads the
// `pg_trgm.similarity_threshold` GUC, which would put half the decision in a session
// setting nothing in this repo sets. The bar belongs in config.ts and nowhere else.
//
// ponytail: no trigram index, and the join is every promoted pair of a kind — ~200 nodes
// is ~40k comparisons of short strings, well under the cost of the annotation reads either
// side of it. Add a GIN index on the normalized name if the working set ever grows a
// digit.
async function stageMergeCandidates(manager: EntityManager): Promise<void> {
  await manager.query(
    `CREATE TEMP TABLE "resolution_merge_candidate" ON COMMIT DROP AS
     WITH promoted AS (
       SELECT e."id", e."kind", e."normalizedName",
              COALESCE(e."featureId", '') AS "featureKey", c."articleCount"
         FROM "entities" e
         JOIN "resolution_candidate" c
           ON c."kind" = e."kind"
          AND c."normalizedName" = e."normalizedName"
          AND c."featureKey" = COALESCE(e."featureId", '')
     )
     SELECT s."id" AS "survivorEntityId", m."id" AS "mergedEntityId",
            s."kind", s."featureKey",
            s."normalizedName" AS "survivorName", m."normalizedName" AS "mergedName",
            s."articleCount" AS "survivorArticleCount", m."articleCount" AS "mergedArticleCount",
            similarity(s."normalizedName", m."normalizedName") AS "similarity"
       FROM promoted s
       JOIN promoted m
         ON m."kind" = s."kind" AND m."featureKey" = s."featureKey"
        -- Each unordered pair appears once, already oriented: the better-attested name
        -- survives, ties by name so the choice is stable across passes rather than
        -- decided by whichever row Postgres returned first.
        AND (s."articleCount" > m."articleCount"
             OR (s."articleCount" = m."articleCount" AND s."normalizedName" < m."normalizedName"))
      WHERE similarity(s."normalizedName", m."normalizedName") >= $1
        AND NOT ${refusedPairSql('s."kind"', 's."featureKey"', 's."normalizedName"', 'm."normalizedName"')}`,
    [ENTITY_MERGE_REVIEW_SIMILARITY],
  );
}

// The two halves of the same decision: above the automatic bar the pass merges, and in the
// band beneath it the pair is held for an Admin and nothing changes.
//
// The merges run one at a time in Node rather than as one statement, because they compose:
// three near-identical names give A~B and A~C, and folding both into A means the second
// merge has to see the first — including the alias repointing that keeps targets terminal.
// A handful of pairs a pass clear the bar (two of sixty measured), so a loop of small
// statements costs nothing next to the annotation reads either side of it.
async function resolveMerges(manager: EntityManager): Promise<{ merged: number; proposed: number }> {
  await stageMergeCandidates(manager);

  const automatic = (await manager.query(
    `SELECT "survivorEntityId", "mergedEntityId", "kind", "featureKey", "survivorName", "mergedName"
       FROM "resolution_merge_candidate"
      WHERE "similarity" >= $1
      ORDER BY "similarity" DESC, "survivorName", "mergedName"`,
    [ENTITY_MERGE_AUTO_SIMILARITY],
  )) as {
    survivorEntityId: string;
    mergedEntityId: string;
    kind: PromotableKind;
    featureKey: string;
    survivorName: string;
    mergedName: string;
  }[];

  let merged = 0;
  for (const pair of automatic) {
    // A name merged away earlier in this loop is gone, so a later pair naming it has
    // already been decided. Skipped rather than re-oriented: whichever Entity it folded
    // into is the survivor now, and the next pass proposes the remaining pair afresh
    // against the name that is actually there.
    const [{ live }] = (await manager.query(
      `SELECT COUNT(*)::int AS live FROM "entities" WHERE "id" = ANY($1::uuid[])`,
      [[pair.survivorEntityId, pair.mergedEntityId]],
    )) as { live: number }[];
    if (live !== 2) continue;

    await applyEntityMerge(
      manager,
      { id: pair.survivorEntityId, kind: pair.kind, normalizedName: pair.survivorName, featureKey: pair.featureKey },
      { id: pair.mergedEntityId, kind: pair.kind, normalizedName: pair.mergedName, featureKey: pair.featureKey },
    );
    merged += 1;
  }

  // The merges above wrote aliases, so the refusal memory reads differently now than it did
  // at staging: folding A into C brings the pair (C, B) under a refusal made about (A, B),
  // which the staging could not have seen because the alias did not exist yet. Re-read here
  // rather than left to the next pass — v3 §18.5 puts the wrong merge on the harmful side of
  // the trade, and a proposal an Admin can accept for an hour is one.
  await manager.query(
    `DELETE FROM "resolution_merge_candidate" c
      WHERE ${refusedPairSql('c."kind"', 'c."featureKey"', 'c."survivorName"', 'c."mergedName"')}`,
  );

  // Upserted on the pair rather than deleted and re-inserted. A proposal is derived state
  // and its measurements are refreshed from what this pass read, but its *id* is what an
  // Admin's decision names: an id regenerated hourly would 404 every decision made against
  // a queue older than one pass, so the whole review band would go quiet on a schedule.
  //
  // The join back to `entities` is what excludes the pairs the loop above merged away;
  // their proposals went by cascade with the Entity.
  await manager.query(
    `INSERT INTO "entity_merge_proposals"
       ("survivorEntityId", "mergedEntityId", "similarity", "survivorArticleCount", "mergedArticleCount")
     SELECT c."survivorEntityId", c."mergedEntityId", c."similarity",
            c."survivorArticleCount", c."mergedArticleCount"
       FROM "resolution_merge_candidate" c
       JOIN "entities" s ON s."id" = c."survivorEntityId"
       JOIN "entities" m ON m."id" = c."mergedEntityId"
      WHERE c."similarity" < $1
     ON CONFLICT ("survivorEntityId", "mergedEntityId")
     DO UPDATE SET "similarity" = EXCLUDED."similarity",
                   "survivorArticleCount" = EXCLUDED."survivorArticleCount",
                   "mergedArticleCount" = EXCLUDED."mergedArticleCount"`,
    [ENTITY_MERGE_AUTO_SIMILARITY],
  );

  // The other half of "derived": what this pass no longer stages stops being a proposal — a
  // pair that left the band, one refused since, one the fold re-oriented. Orientation is
  // part of the pair, so a flip is this delete together with the insert above, and the
  // reviewer is asked about the pair as it now stands rather than as it once did.
  await manager.query(
    `DELETE FROM "entity_merge_proposals" p
      WHERE NOT EXISTS (
        SELECT 1 FROM "resolution_merge_candidate" c
         WHERE c."survivorEntityId" = p."survivorEntityId"
           AND c."mergedEntityId" = p."mergedEntityId"
           AND c."similarity" < $1
      )`,
    [ENTITY_MERGE_AUTO_SIMILARITY],
  );
  const [{ count: proposed }] = (await manager.query(
    `SELECT COUNT(*)::int AS count FROM "entity_merge_proposals"`,
  )) as Counted[];

  return { merged, proposed };
}

// The co-occurrence graph, rebuilt whole: one citation row per pair per Article, for
// the pairs that are among the strongest EDGES_PER_ENTITY of *either* endpoint. That
// rule is `bothEndsBoundSql` (./edgeBound.ts) rather than a second copy of it here,
// because the read path bounds one screen the same way over a smaller number, and two
// spellings of one rule drift into two different graphs without either one failing.
//
// Because a mention row is distinct per (Article, Entity), a pair is observed at most
// once per Article, so the weight is a count of Articles and the citation index cannot
// be violated by an Article naming the same person twice.
//
// Deleting and reinserting churns `entity_edges."id"` every pass, unlike an Entity's id,
// which promotion deliberately keeps. Nothing references an edge by id and nothing should:
// an edge is identified by its pair, and its rows are the citations behind it.
async function rebuildEdges(manager: EntityManager): Promise<number> {
  await manager.query(`DELETE FROM "entity_edges"`);
  await manager.query(
    `WITH cite AS MATERIALIZED (
       SELECT m1."entityId" AS a, m2."entityId" AS b, m1."articleId"
         FROM "resolution_mention" m1
         JOIN "resolution_mention" m2
           ON m2."articleId" = m1."articleId" AND m2."entityId" > m1."entityId"
     ),
     pair AS (SELECT a, b, COUNT(*)::int AS w FROM cite GROUP BY 1, 2),
     ${bothEndsBoundSql("$1")}
     INSERT INTO "entity_edges" ("entityAId", "entityBId", "articleId")
     SELECT c.a, c.b, c."articleId" FROM cite c JOIN kept k ON k.a = c.a AND k.b = c.b`,
    [EDGES_PER_ENTITY],
  );
  const [row] = (await manager.query(
    `SELECT COUNT(*)::int AS count FROM (SELECT DISTINCT "entityAId", "entityBId" FROM "entity_edges") p`,
  )) as Counted[];
  return row.count;
}

// The one new seam over the graph's write side. No `deps` argument: resolution reads
// annotations that are already staged and needs no provider, so there is nothing to
// inject and nothing to stub.
//
// Every pass rebuilds the whole graph inside one transaction, so a reader sees the
// previous graph until this one commits and a failure leaves the previous graph intact.
// That, plus ON CONFLICT keeping ids, is what makes a re-run over unchanged annotations
// produce the same Entities and the same edges.
//
// ponytail: the cost of a pass scales with the retained window, not with what arrived
// since the last one — three reads of the annotation table an hour. Maintain the graph
// per ingested window instead only once that shows up in the worker's timings; the
// arithmetic that makes incremental promotion correct across a rolling floor is a great
// deal more code than this.
export async function runEntityResolution(): Promise<EntityResolutionRun> {
  const runs = AppDataSource.getRepository(EntityResolutionRun);
  const run = await runs.save({ status: "running" as const, startedAt: new Date() });
  const tally = {
    annotationsRead: 0,
    articlesRead: 0,
    considered: 0,
    promoted: 0,
    demoted: 0,
    edgesBuilt: 0,
    merged: 0,
    proposed: 0,
  };
  // What the pass *read* is true whether or not it committed, so a failed run still states the
  // size of the input it failed on. What it *wrote* is not: the transaction rolled back, so
  // those counters are assigned only once it commits. A failed run therefore reports nothing
  // promoted, nothing demoted, nothing merged or proposed, no edges — and every candidate below
  // the floor, which is what the graph now says about them — rather than Entities the graph does
  // not have.
  const ledger = () => ({ ...tally, belowFloor: tally.considered - tally.promoted });

  try {
    const written = await AppDataSource.transaction(async (manager) => {
      const read = await readCounts(manager);
      tally.annotationsRead = read.annotations;
      tally.articlesRead = read.articles;

      await stageCandidates(manager);
      const [counts] = (await manager.query(
        `SELECT COUNT(*)::int AS considered, COUNT(*) FILTER (WHERE "articleCount" >= $1)::int AS promoted
           FROM "resolution_candidate"`,
        [ENTITY_PROMOTION_FLOOR],
      )) as { considered: number; promoted: number }[];
      tally.considered = counts.considered;

      await promote(manager);
      const demoted = await demote(manager);
      // Between promotion and the edges, and in that order for two reasons: candidate
      // generation compares names that are Entities, which is only true after promote,
      // and the graph is bounded per Entity, so merging first is what keeps
      // EDGES_PER_ENTITY a bound on the nodes that actually remain. A merged name's
      // occurrences reach the survivor because `stageMentions` reads the same aliases.
      const { merged, proposed } = await resolveMerges(manager);
      await stageMentions(manager);
      const edgesBuilt = await rebuildEdges(manager);
      return { promoted: counts.promoted, demoted, edgesBuilt, merged, proposed };
    });
    Object.assign(tally, written);
    await runs.update({ id: run.id }, { status: "succeeded", completedAt: new Date(), ...ledger(), errorSummary: null });
  } catch (err) {
    await runs.update(
      { id: run.id },
      {
        status: "failed",
        completedAt: new Date(),
        ...ledger(),
        errorSummary: err instanceof Error ? err.message : String(err),
      },
    );
  }

  return runs.findOneByOrFail({ id: run.id });
}
