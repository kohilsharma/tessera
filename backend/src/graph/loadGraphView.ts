import { AppDataSource } from "../data-source";
import { GDELT_RETENTION_DAYS } from "../ingestion/retention";
import { ENTITY_PROMOTION_FLOOR, VIEW_EDGES_PER_ENTITY, VIEW_NODES, type PromotableKind } from "./config";

// The graph's read seam (#68), the one every reader surface goes through, as
// `runEntityResolution` is the one every write goes through. #69's Entity neighbourhood
// is the same picture over a different selection, so it belongs here rather than beside
// it: two read paths would be two chances to disagree about what the graph contains.
//
// Nothing here takes a caller's number. The bounds live in `config.ts` and are applied
// below, so `GET /graph` needs no parameters and a widened bound is not a request a
// caller can make — which is what #68 asks for, and cheaper than validating a limit.
//
// There is also no time predicate below, and that is the retained window rather than a
// filter left out: retention deletes an aged-out firehose Article and its (pair, Article)
// citations cascade with it, and the pass demotes an Entity whose annotations have left
// the window. What is stored *is* the window, so a date filter here would be a second,
// looser copy of the rule that already emptied those rows.

export type GraphNode = {
  id: string;
  kind: PromotableKind;
  canonicalName: string;
  // The Articles this Entity is cited in through the edges the pass kept — the same
  // reporting a reader can open, not a separate count they would have to reconcile
  // against it.
  articleCount: number;
};

// The pair as stored: ordered by id, so an edge is one row and not two, and its weight
// is the number of Articles that reported both names together.
export type GraphEdge = { entityAId: string; entityBId: string; weight: number };

export type GraphView = {
  // Why the window rolls and why a name is in the graph at all. Returned rather than
  // restated on the page: the reader is owed the corpus this view reads, and a frontend
  // constant would be a second copy of a number the backend owns.
  retainedDays: number;
  promotionFloor: number;
  // The whole working set the picture was drawn from, against the picture's own length —
  // so a page can say which fraction of the graph it is showing instead of implying the
  // graph is 60 names wide.
  entityCount: number;
  articleCount: number;
  from: Date | null;
  to: Date | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type SubstrateRow = { entityCount: number; articleCount: number; from: Date | null; to: Date | null };

// Presence read from the citations rather than from `gkg_annotations`: the annotations
// are millions of rows, `entity_edges` is a few thousand with both endpoints indexed,
// and the citations are what the picture actually rests on — a node ranked by reporting
// a reader cannot open would be ranked by something the graph does not show.
//
// An Entity nothing co-cites has no row here and so is never drawn. That is the honest
// reading of a co-occurrence graph — an isolated dot asserts nothing and opens onto
// nothing — and `entityCount` still states that the working set is wider than the
// picture.
const NODES_SQL = `
  SELECT e."id", e."kind", e."canonicalName", COUNT(DISTINCT cite."articleId")::int AS "articleCount"
    FROM "entities" e
    JOIN (
      SELECT "entityAId" AS "entityId", "articleId" FROM "entity_edges"
      UNION ALL
      SELECT "entityBId", "articleId" FROM "entity_edges"
    ) cite ON cite."entityId" = e."id"
   GROUP BY e."id", e."kind", e."canonicalName"
   ORDER BY "articleCount" DESC, e."canonicalName" ASC, e."id" ASC
   LIMIT $1`;

// Edges among the drawn nodes only, then bounded again from both ends the way the pass
// bounds its own (`rebuildEdges`): a pair inside either endpoint's strongest few is
// kept, so a node is never drawn as an isolate because its one tie was its neighbour's
// seventh. `COUNT(*)` is the weight because a unique index makes one row per (pair,
// Article) — the count cannot disagree with the citations it counts.
const EDGES_SQL = `
  WITH pair AS MATERIALIZED (
    SELECT "entityAId" AS a, "entityBId" AS b, COUNT(*)::int AS w
      FROM "entity_edges"
     WHERE "entityAId" = ANY($1::uuid[]) AND "entityBId" = ANY($1::uuid[])
     GROUP BY 1, 2
  ),
  directed AS (
    SELECT a AS "self", b AS "other", w FROM pair
    UNION ALL
    SELECT b, a, w FROM pair
  ),
  ranked AS (
    SELECT "self", "other",
           ROW_NUMBER() OVER (PARTITION BY "self" ORDER BY w DESC, "other" ASC) AS "rank"
      FROM directed
  ),
  kept AS (
    SELECT DISTINCT LEAST("self", "other") AS a, GREATEST("self", "other") AS b
      FROM ranked WHERE "rank" <= $2
  )
  SELECT p.a AS "entityAId", p.b AS "entityBId", p.w AS "weight"
    FROM pair p JOIN kept k ON k.a = p.a AND k.b = p.b
   ORDER BY p.w DESC, p.a ASC, p.b ASC`;

// The corpus statement's facts, measured over every edge rather than over the drawn
// ones: this is what the graph was built from, which is what a reader needs told, and
// it is a different question from which of it fits on a screen. Reporting that cites no
// edge — a window where one promoted name appeared alone — is not part of the graph and
// so does not stretch the window it states.
const SUBSTRATE_SQL = `
  SELECT (SELECT COUNT(*)::int FROM "entities") AS "entityCount",
         COUNT(DISTINCT e."articleId")::int AS "articleCount",
         MIN(a."publishedAt") AS "from",
         MAX(a."publishedAt") AS "to"
    FROM "entity_edges" e
    JOIN "articles" a ON a."id" = e."articleId"`;

export async function loadGraphView(): Promise<GraphView> {
  const [nodes, [substrate]] = await Promise.all([
    AppDataSource.query(NODES_SQL, [VIEW_NODES]) as Promise<GraphNode[]>,
    AppDataSource.query(SUBSTRATE_SQL) as Promise<SubstrateRow[]>,
  ]);

  const edges =
    nodes.length === 0
      ? []
      : ((await AppDataSource.query(EDGES_SQL, [
          nodes.map((node) => node.id),
          VIEW_EDGES_PER_ENTITY,
        ])) as GraphEdge[]);

  return {
    retainedDays: GDELT_RETENTION_DAYS,
    promotionFloor: ENTITY_PROMOTION_FLOOR,
    entityCount: substrate.entityCount,
    articleCount: substrate.articleCount,
    from: substrate.from,
    to: substrate.to,
    nodes,
    edges,
  };
}
