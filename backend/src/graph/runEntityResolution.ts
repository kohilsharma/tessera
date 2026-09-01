import type { EntityManager } from "typeorm";
import { AppDataSource } from "../data-source";
import { EntityResolutionRun } from "../entities/EntityResolutionRun";
import { EDGES_PER_ENTITY, ENTITY_PROMOTION_FLOOR, PROMOTABLE_KINDS } from "./config";

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
              ${normalizedNameSql('ga."surfaceName"')} AS "normalizedName",
              ${featureKeySql} AS "featureKey",
              ga."surfaceName",
              ga."articleId"
         FROM "gkg_annotations" ga
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
       JOIN "entities" e
         ON e."kind" = ga."kind"
        AND e."normalizedName" = ${normalizedNameSql('ga."surfaceName"')}
        AND COALESCE(e."featureId", '') = ${featureKeySql}
      WHERE ga."kind" = ANY($1::varchar[])`,
    [PROMOTABLE_KINDS],
  );
}

// The co-occurrence graph, rebuilt whole: one citation row per pair per Article, for
// the pairs that are among the strongest EDGES_PER_ENTITY of *either* endpoint. The
// union is the point — bounding from one side only would drop an Entity's third
// strongest neighbour on the grounds that the Entity was that neighbour's thirtieth.
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
    `WITH pair AS MATERIALIZED (
       SELECT m1."entityId" AS a, m2."entityId" AS b, m1."articleId"
         FROM "resolution_mention" m1
         JOIN "resolution_mention" m2
           ON m2."articleId" = m1."articleId" AND m2."entityId" > m1."entityId"
     ),
     weight AS (SELECT a, b, COUNT(*)::int AS w FROM pair GROUP BY 1, 2),
     directed AS (
       SELECT a AS "self", b AS "other", w FROM weight
       UNION ALL
       SELECT b, a, w FROM weight
     ),
     ranked AS (
       SELECT "self", "other",
              ROW_NUMBER() OVER (PARTITION BY "self" ORDER BY w DESC, "other" ASC) AS "rank"
         FROM directed
     ),
     kept AS (
       SELECT DISTINCT LEAST("self", "other") AS a, GREATEST("self", "other") AS b
         FROM ranked WHERE "rank" <= $1
     )
     INSERT INTO "entity_edges" ("entityAId", "entityBId", "articleId")
     SELECT p.a, p.b, p."articleId" FROM pair p JOIN kept k ON k.a = p.a AND k.b = p.b`,
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
  const tally = { annotationsRead: 0, articlesRead: 0, considered: 0, promoted: 0, demoted: 0, edgesBuilt: 0 };
  // What the pass *read* is true whether or not it committed, so a failed run still states the
  // size of the input it failed on. What it *wrote* is not: the transaction rolled back, so
  // those three counters are assigned only once it commits. A failed run therefore reports
  // nothing promoted, nothing demoted, no edges — and every candidate below the floor, which is
  // what the graph now says about them — rather than Entities the graph does not have.
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
      await stageMentions(manager);
      const edgesBuilt = await rebuildEdges(manager);
      return { promoted: counts.promoted, demoted, edgesBuilt };
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
