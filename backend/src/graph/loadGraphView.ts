import { AppDataSource } from "../data-source";
import { GDELT_RETENTION_DAYS } from "../ingestion/retention";
import { toPublicArticle, type ArticleProjection } from "../lib/articleView";
import { acceptedMembership } from "../lib/storyMembership";
import {
  ENTITY_PROMOTION_FLOOR,
  NEIGHBOURHOOD_DEPTH,
  PROPOSAL_SAMPLE_ARTICLES,
  VIEW_EDGE_CITATIONS,
  VIEW_EDGES_PER_ENTITY,
  VIEW_NODE_CAP,
  VIEW_THEME_FACETS,
  GRAPH_EXCLUDED_NAMES_SQL,
  type PromotableKind,
} from "./config";
import { bothEndsBoundSql } from "./edgeBound";

// The graph's read seam (#68, #69), the one every reader surface goes through, as
// `runEntityResolution` is the one every write goes through. One Entity's neighbourhood is
// here rather than beside it because it is the same picture over a different selection: the
// promotion floor, the read-side quality bound, the node cap and the both-ends edge bound are applied by the statements
// below whichever surface asked, so the two cannot disagree about what is in the graph.
//
// Nothing here takes a caller's number. The bounds live in `config.ts` and are applied
// below, so `GET /graph` needs no parameters and a widened bound is not a request a
// caller can make — which is what #68 asks for, and cheaper than validating a limit.
//
// The one thing a caller does say is a Theme, and it is safe to accept for the reason it is
// worth having: it only ever narrows. ADR-0028 keeps Themes out of the graph as nodes —
// ~48 per Article makes theme-to-theme co-occurrence a complete graph — but that same
// controlled vocabulary is what a crowded neighbourhood needs to be read one subject at a
// time. So it is threaded through as `$1` of every statement that reads a citation, which
// is what keeps a weight, a window and an opened list all counting the same Articles.
//
// There is no time predicate below either, and that is deliberate rather than left out —
// but it does not make what is stored equal to the retained window. Retention bounds the
// firehose half only: it deletes an aged-out `metadata_only` GDELT row and its (pair,
// Article) citations cascade with it. Everything CONTEXT.md's *Retention Window* exempts
// outlives it — the Curated Corpus, which ADR-0029 holds open to resolution, anything
// enriched above `metadata_only`, and any Article a Story or a Brief has taken hold of —
// so the graph can and should cite reporting older than `retainedDays`. Adding a date
// filter here would hide exactly the corpus ADR-0029 opened.
//
// Which makes `retainedDays` and `from`/`to` two different facts, and the reason both are
// returned: the first is the rule bounding what the firehose leaves behind, the second is
// the span of the reporting actually cited. A reader must be told the second, not shown
// the first and left to infer it.

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
  // The rule that bounds the firehose half, and the floor that decides whether a name is
  // in the graph at all. Returned rather than restated on the page: the reader is owed the
  // corpus this view reads, and a frontend constant would be a second copy of a number the
  // backend owns. `retainedDays` is not the graph's span — `from`/`to` below are.
  retainedDays: number;
  promotionFloor: number;
  // The eligible working set the picture was drawn from, against the picture's own length —
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

// The citations every statement below reads, and the only place the Theme facet is applied:
// `$1` is a Theme or NULL, and NULL is the whole graph. Applied to the *citations* rather
// than to the picture afterwards, so a facet narrows what an edge weighs and what a profile
// counts rather than just which lines survive — a weight that counted reporting the drawer
// then refused to open would be the page disagreeing with itself one click later.
const CITED_SQL = `
  cited AS (
    SELECT ee."entityAId", ee."entityBId", ee."articleId"
      FROM "entity_edges" ee
      JOIN "entities" ea ON ea."id" = ee."entityAId"
      JOIN "entities" eb ON eb."id" = ee."entityBId"
     WHERE ($1::text IS NULL
        OR EXISTS (
             SELECT 1 FROM "gkg_annotations" ga
              WHERE ga."articleId" = ee."articleId"
                AND ga."kind" = 'theme'
                AND ga."surfaceName" = $1
           ))
       AND ea."normalizedName" <> ALL(${GRAPH_EXCLUDED_NAMES_SQL})
       AND eb."normalizedName" <> ALL(${GRAPH_EXCLUDED_NAMES_SQL})
  )`;

// Presence read from the citations rather than from `gkg_annotations`: the annotations
// are millions of rows, `entity_edges` is a few thousand with both endpoints indexed,
// and the citations are what the picture actually rests on — a node ranked by reporting
// a reader cannot open would be ranked by something the graph does not show.
//
// An Entity nothing co-cites has no row here and so is never drawn by the global view.
// That is the honest reading of a co-occurrence graph — an isolated dot asserts nothing
// and opens onto nothing — and `entityCount` still states that the working set is wider
// than the picture. A neighbourhood keeps the focus when it has no eligible ties, because
// there it is the name the reader asked for.
const PRESENCE_SQL = `
  presence AS (
    SELECT "entityId", COUNT(DISTINCT "articleId")::int AS "articleCount"
      FROM (
        SELECT "entityAId" AS "entityId", "articleId" FROM cited
        UNION ALL
        SELECT "entityBId", "articleId" FROM cited
      ) cite
     GROUP BY "entityId"
  )`;

const NODES_SQL = `
  WITH ${CITED_SQL}, ${PRESENCE_SQL}
  SELECT e."id", e."kind", e."canonicalName", p."articleCount"
    FROM presence p
   JOIN "entities" e ON e."id" = p."entityId"
   WHERE e."normalizedName" <> ALL(${GRAPH_EXCLUDED_NAMES_SQL})
   ORDER BY p."articleCount" DESC, e."canonicalName" ASC, e."id" ASC
   LIMIT $2`;

// Edges among the drawn nodes only, then bounded again from both ends by the rule the
// pass bounds its own graph with — `bothEndsBoundSql` (./edgeBound.ts), one spelling read
// by both seams over different numbers. `COUNT(*)` is the weight because a unique index
// makes one row per (pair, Article) — the count cannot disagree with the citations it
// counts.
//
// `alsoKeep` is the one thing a neighbourhood needs that the global view does not: a
// clause that exempts the focus's own ties from the bound. Every neighbour on that page is
// there *because* it ties to the focus, so a neighbour drawn without that tie is a dot
// placed for a reason the picture no longer shows.
function boundedEdgesSql(alsoKeep = ""): string {
  return `
  WITH ${CITED_SQL},
  pair AS MATERIALIZED (
    SELECT "entityAId" AS a, "entityBId" AS b, COUNT(*)::int AS w
      FROM cited
     WHERE "entityAId" = ANY($2::uuid[]) AND "entityBId" = ANY($2::uuid[])
     GROUP BY 1, 2
  ),
  ${bothEndsBoundSql("$3", alsoKeep)}
  SELECT p.a AS "entityAId", p.b AS "entityBId", p.w AS "weight"
    FROM pair p JOIN kept k ON k.a = p.a AND k.b = p.b
   ORDER BY p.w DESC, p.a ASC, p.b ASC`;
}

const EDGES_SQL = boundedEdgesSql();

// The corpus statement's facts, measured over every eligible edge rather than over the drawn
// ones: this is what the graph was built from, which is what a reader needs told, and
// it is a different question from which of it fits on a screen. Reporting that cites no
// edge — a window where one promoted name appeared alone — is not part of the graph and
// so does not stretch the span it states.
const SUBSTRATE_SQL = `
  SELECT (SELECT COUNT(*)::int FROM "entities"
           WHERE "normalizedName" <> ALL(${GRAPH_EXCLUDED_NAMES_SQL})) AS "entityCount",
         COUNT(DISTINCT e."articleId")::int AS "articleCount",
         MIN(a."publishedAt") AS "from",
         MAX(a."publishedAt") AS "to"
    FROM "entity_edges" e
    JOIN "entities" ea ON ea."id" = e."entityAId"
    JOIN "entities" eb ON eb."id" = e."entityBId"
    JOIN "articles" a ON a."id" = e."articleId"
   WHERE ea."normalizedName" <> ALL(${GRAPH_EXCLUDED_NAMES_SQL})
     AND eb."normalizedName" <> ALL(${GRAPH_EXCLUDED_NAMES_SQL})`;

// One snapshot for all three reads. `runEntityResolution` rebuilds the whole graph inside
// one transaction — `DELETE FROM "entity_edges"` and then the insert — and under READ
// COMMITTED each statement takes its own snapshot, so a read overlapping the hourly commit
// could pair nodes counted before it with edges selected after it and draw every name as an
// isolate, or state an `entityCount` that disagrees with the nodes beside it. REPEATABLE
// READ pins one snapshot for the whole transaction. It is read-only, so unlike SERIALIZABLE
// it cannot fail with a serialization error and there is nothing to retry; the cost is that
// the three statements share one connection and run in sequence rather than concurrently.
export async function loadGraphView(): Promise<GraphView> {
  return AppDataSource.transaction("REPEATABLE READ", async (manager) => {
    // `null` for the facet throughout: the global view is every reader's one shared
    // picture, and a Theme narrows a name's surroundings rather than the whole graph.
    const nodes = (await manager.query(NODES_SQL, [null, VIEW_NODE_CAP])) as GraphNode[];
    const [substrate] = (await manager.query(SUBSTRATE_SQL)) as SubstrateRow[];
    const edges =
      nodes.length === 0
        ? []
        : ((await manager.query(EDGES_SQL, [
            null,
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
  });
}

// What the page is about: the Entity, the names folded into it, and how much reporting it
// was seen in. `articleCount`, `from` and `to` are measured over the citations, which is
// the same quantity the global view sizes this name's node by — one number, so the two
// pages cannot state different amounts of reporting for one name.
export type EntityProfile = {
  id: string;
  kind: PromotableKind;
  canonicalName: string;
  // The normalized names merged into this one (#67). Normalized because that is the whole
  // of what a fold stores: `entity_aliases` is keyed by normalized name and keeps no
  // surface spelling. ponytail: carry the surface form when a page wants the reported case.
  aliases: string[];
  articleCount: number;
  from: Date | null;
  to: Date | null;
};

// A Theme and how much of this name's reporting carried it. Never a node (ADR-0028) — the
// vocabulary the picture is narrowed by, and the reason a crowded name is readable at all.
export type ThemeFacet = { theme: string; articleCount: number };

export type Neighbourhood = {
  retainedDays: number;
  promotionFloor: number;
  // `NEIGHBOURHOOD_DEPTH` (./config.ts), in the payload because a bounded reading has to
  // say what it bounded (#69).
  depth: number;
  focus: EntityProfile;
  // The facet in force, echoed back rather than trusted from the caller's own URL: a page
  // that states which Theme it is narrowed by should be stating the one that was applied.
  theme: string | null;
  themes: ThemeFacet[];
  // Every name one hop out, against how many of them fit — the neighbourhood's own version
  // of the global view's `entityCount`, so the page never implies it drew everything.
  neighbourCount: number;
  // The focus first, then its neighbours strongest tie first. The focus is always here,
  // including when nothing ties to it, so a caller never has to rebuild the middle of the
  // picture out of the profile.
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// The profile. `span` is one row whatever the facet leaves — an aggregate with no GROUP BY
// — so a focus whose every co-mention has rolled out of the retained window reads as a
// count of zero and a null window rather than as a missing name. The `WHERE` is what makes
// this the existence check for the whole page: no `entities` row, no neighbourhood, and the
// route answers 404 instead of a name with nothing around it.
const FOCUS_SQL = `
  WITH ${CITED_SQL},
  own AS (
    SELECT DISTINCT "articleId" FROM cited WHERE "entityAId" = $2 OR "entityBId" = $2
  ),
  span AS (
    SELECT COUNT(*)::int AS "articleCount",
           MIN(a."publishedAt") AS "from",
           MAX(a."publishedAt") AS "to"
      FROM own JOIN "articles" a ON a."id" = own."articleId"
  )
  SELECT e."id", e."kind", e."canonicalName",
         span."articleCount", span."from", span."to",
         COALESCE((
           SELECT array_agg(al."normalizedName" ORDER BY al."normalizedName")
             FROM "entity_aliases" al
            WHERE al."kind" = e."kind"
              AND al."featureKey" = COALESCE(e."featureId", '')
              AND al."targetNormalizedName" = e."normalizedName"
         ), '{}') AS "aliases"
    FROM "entities" e CROSS JOIN span
   WHERE e."id" = $2
     AND e."normalizedName" <> ALL(${GRAPH_EXCLUDED_NAMES_SQL})`;

// One hop out, strongest tie first, and the count of the whole hop beside it. `COUNT(*)
// OVER ()` is evaluated before the LIMIT, so the page can say "20 of 34 names" from one
// statement rather than measuring the crowd it just bounded away with a second one.
//
// Ordered by the tie first and presence second: this page is about one name's surroundings,
// so what it is *nearest* is the ranking a reader came for, and how well reported a
// neighbour is only breaks a tie between equals.
const NEIGHBOURS_SQL = `
  WITH ${CITED_SQL}, ${PRESENCE_SQL},
  tie AS (
    SELECT CASE WHEN "entityAId" = $2 THEN "entityBId" ELSE "entityAId" END AS "entityId",
           COUNT(*)::int AS w
      FROM cited
     WHERE "entityAId" = $2 OR "entityBId" = $2
     GROUP BY 1
  )
  SELECT e."id", e."kind", e."canonicalName", p."articleCount",
         (COUNT(*) OVER ())::int AS "neighbourCount"
    FROM tie t
    JOIN "entities" e ON e."id" = t."entityId"
    JOIN presence p ON p."entityId" = t."entityId"
   ORDER BY t.w DESC, p."articleCount" DESC, e."canonicalName" ASC, e."id" ASC
   LIMIT $3`;

// The facet vocabulary, and the one statement here that deliberately does *not* take the
// Theme in force: it is computed over the focus's whole reporting, so a reader who narrows
// to one Theme can still see — and reach — the others. Filtered by the facet it offers, the
// list would collapse to the one already chosen and every neighbourhood would dead-end on
// its first click.
//
// Read straight from the annotations rather than from a resolved vocabulary, because there
// is nothing to resolve: a Theme is a controlled-vocabulary code GDELT reported, and the
// page shows it verbatim. ponytail: a code like `ECON_STOCKMARKET` reads as shouting — add
// a label map when someone has one for 2,072 values.
const THEMES_SQL = `
  WITH own AS (
    SELECT DISTINCT ee."articleId"
      FROM "entity_edges" ee
      JOIN "entities" ea ON ea."id" = ee."entityAId"
      JOIN "entities" eb ON eb."id" = ee."entityBId"
     WHERE (ee."entityAId" = $1 OR ee."entityBId" = $1)
       AND ea."normalizedName" <> ALL(${GRAPH_EXCLUDED_NAMES_SQL})
       AND eb."normalizedName" <> ALL(${GRAPH_EXCLUDED_NAMES_SQL})
  )
  SELECT ga."surfaceName" AS "theme", COUNT(DISTINCT ga."articleId")::int AS "articleCount"
    FROM own
    JOIN "gkg_annotations" ga ON ga."articleId" = own."articleId" AND ga."kind" = 'theme'
   GROUP BY 1
   ORDER BY "articleCount" DESC, "theme" ASC
   LIMIT $2`;

const NEIGHBOURHOOD_EDGES_SQL = boundedEdgesSql(` OR "self" = $4`);

type NeighbourRow = GraphNode & { neighbourCount: number };

// One Entity's neighbourhood, or `null` where the graph no longer holds that name — an id
// that was never one, and a name a merge or a demotion took away, are the same fact to a
// reader and both belong at the 404 the route answers.
//
// One `REPEATABLE READ` snapshot for all four statements, for the reason the global view
// takes one: the hourly pass rebuilds the whole graph in a single transaction, so under
// READ COMMITTED a page could state a profile counted before that commit beside neighbours
// selected after it.
export async function loadEntityNeighbourhood(
  entityId: string,
  theme: string | null,
): Promise<Neighbourhood | null> {
  return AppDataSource.transaction("REPEATABLE READ", async (manager) => {
    const [focus] = (await manager.query(FOCUS_SQL, [theme, entityId])) as EntityProfile[];
    if (!focus) return null;

    const neighbours = (await manager.query(NEIGHBOURS_SQL, [
      theme,
      entityId,
      VIEW_NODE_CAP - 1,
    ])) as NeighbourRow[];
    const themes = (await manager.query(THEMES_SQL, [entityId, VIEW_THEME_FACETS])) as ThemeFacet[];

    // The focus is a node like any other, drawn from the profile so its size means what
    // every other node's size means. `neighbourCount` is dropped here rather than left on
    // the row: it is one fact about the hop, not a fact about each name in it.
    const nodes: GraphNode[] = [
      { id: focus.id, kind: focus.kind, canonicalName: focus.canonicalName, articleCount: focus.articleCount },
      ...neighbours.map(({ id, kind, canonicalName, articleCount }) => ({ id, kind, canonicalName, articleCount })),
    ];
    const edges =
      neighbours.length === 0
        ? []
        : ((await manager.query(NEIGHBOURHOOD_EDGES_SQL, [
            theme,
            nodes.map((node) => node.id),
            VIEW_EDGES_PER_ENTITY,
            entityId,
          ])) as GraphEdge[]);

    return {
      retainedDays: GDELT_RETENTION_DAYS,
      promotionFloor: ENTITY_PROMOTION_FLOOR,
      depth: NEIGHBOURHOOD_DEPTH,
      focus,
      theme,
      themes,
      neighbourCount: neighbours[0]?.neighbourCount ?? 0,
      nodes,
      edges,
    };
  });
}

// The citation invariant, openable (#69). Every EntityEdge carries the Article it was
// observed in, so the weight a line is drawn at is a count of reporting a reader can read
// rather than a number to take on trust.
//
// Metadata only, and that is one surface for body text rather than a gap in the Terms Class
// gate: `toPublicArticle` does not select `analysisText` at all, so this list carries none
// whatever the Publisher's class clears (ADR-0032 clears a good deal more than it used to).
// Text a reader may read is reachable through the Article record, where that gate lives; a
// second surface serving bodies would be a second place to get it wrong. The mode rides
// along so a reader knows what Tessera holds.
export type EdgeCitation = ReturnType<typeof toPublicArticle> & {
  // Where the reporting is also part of a Story a reader can open. Null for reporting the
  // clustering pass is still unsure about, and for the firehose half the graph rests on,
  // which belongs to no Story at all — the join uses `src/lib/storyMembership.ts`, the one
  // accepted-membership predicate every reader surface tests.
  story: { id: string; slug: string; title: string } | null;
};

// The whole weight, then the bounded list of it: a drawer is something a person reads, so
// it holds the newest `VIEW_EDGE_CITATIONS` and says how many there were. `COUNT(*) OVER ()`
// is computed before the LIMIT, so the two numbers come from one statement and cannot
// disagree about the pair they describe.
export type EdgeCitations = { weight: number; citations: EdgeCitation[] };

// The one LEFT JOIN through `acceptedMembership`, as it arrives on a row. Named because
// two statements here select it and one predicate decides it.
type StoryColumns = { storyId: string | null; storySlug: string | null; storyTitle: string | null };

type CitationRow = Omit<ArticleProjection, "publisher"> &
  StoryColumns & {
    publisherId: string;
    publisherName: string;
    publisherDomain: string;
    weight: number;
  };

// `LEAST`/`GREATEST` rather than two predicates: a pair is stored ordered by id
// (`CHK_entity_edges_ordered`), which is storage's business, and a reader arrives from
// whichever end of the line they clicked. A name paired with itself normalizes to a row the
// schema refuses, so it finds nothing — which is the right answer.
const CITATIONS_SQL = `
  WITH ${CITED_SQL},
  evidence AS (
    SELECT "articleId" FROM cited
     WHERE "entityAId" = LEAST($2::uuid, $3::uuid)
       AND "entityBId" = GREATEST($2::uuid, $3::uuid)
  )
  SELECT a."id", a."title", a."url", a."publishedAt", a."analysisTextMode",
         p."id" AS "publisherId", p."name" AS "publisherName", p."domain" AS "publisherDomain",
         s."id" AS "storyId", s."slug" AS "storySlug", s."title" AS "storyTitle",
         (COUNT(*) OVER ())::int AS "weight"
    FROM evidence
    JOIN "articles" a ON a."id" = evidence."articleId"
    JOIN "publishers" p ON p."id" = a."publisherId"
    LEFT JOIN "stories" s ON s."id" = a."storyId" AND ${acceptedMembership("a")}
   ORDER BY a."publishedAt" DESC, a."id" ASC
   LIMIT $4`;

// The three Story columns are null together or set together — they are one LEFT JOIN's row
// — and checking all three is what says so to the compiler without an assertion. Shared by
// both surfaces that label a citation, so "which of these can open a record" is decided in
// one place however the reader arrived.
const storyOf = (row: StoryColumns) =>
  row.storyId && row.storySlug && row.storyTitle
    ? { id: row.storyId, slug: row.storySlug, title: row.storyTitle }
    : null;

// `null` where the graph holds no edge for the pair, which the route answers as 404: an
// empty list would assert a co-mention that was never reported. One statement, so no
// transaction — the weight and the citations it bounds are one snapshot by construction.
export async function loadEdgeCitations(
  entityAId: string,
  entityBId: string,
  theme: string | null,
): Promise<EdgeCitations | null> {
  const rows = (await AppDataSource.query(CITATIONS_SQL, [
    theme,
    entityAId,
    entityBId,
    VIEW_EDGE_CITATIONS,
  ])) as CitationRow[];
  if (rows.length === 0) return null;

  return {
    weight: rows[0].weight,
    citations: rows.map((row) => ({
      ...toPublicArticle({
        ...row,
        publisher: { id: row.publisherId, name: row.publisherName, domain: row.publisherDomain },
      }),
      story: storyOf(row),
    })),
  };
}

// The reporting behind one side of a merge proposal (#67), read here rather than beside
// the route it serves. AGENTS.md's membership invariant exempts *this seam*, not a route
// that happens to ask the graph the same question: a queue reading `entity_edges` in a
// query of its own would be a second firehose reader outside the one documented exception,
// which is the shape the invariant names as a bug.
//
// Membership is joined for the reason it is joined under an edge — to **label** a
// citation, never to filter one. The names a reviewer decides between are mostly firehose
// reporting, so filtering to Story-backed Articles would empty the very evidence the
// decision rests on; labelling instead lets the queue open a record where there is one and
// the Publisher's own copy where there is not.
//
// Read from the citations rather than from the annotation window: `entity_edges` is a few
// thousand rows with both endpoint columns indexed, where the annotations behind it are
// millions. A name with no kept edge samples nothing, which is honest — its Article count
// still states what the pass counted over the whole window.
export type ProposalCitation = {
  entityId: string;
  id: string;
  title: string;
  url: string;
  publishedAt: Date;
  story: { id: string; slug: string; title: string } | null;
};

type ProposalCitationRow = Omit<ProposalCitation, "story"> & StoryColumns;

const PROPOSAL_CITATIONS_SQL = `
  SELECT ranked."entityId", ranked."id", ranked."title", ranked."url", ranked."publishedAt",
         ranked."storyId", ranked."storySlug", ranked."storyTitle"
    FROM (
      SELECT cite."entityId", a."id", a."title", a."url", a."publishedAt",
             s."id" AS "storyId", s."slug" AS "storySlug", s."title" AS "storyTitle",
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
        LEFT JOIN "stories" s ON s."id" = a."storyId" AND ${acceptedMembership("a")}
    ) ranked
   WHERE ranked."rank" <= $2`;

// Keyed by Entity so a caller asking about both sides of every proposal on a page makes
// one query rather than one per side.
export async function loadProposalCitations(entityIds: string[]): Promise<Map<string, ProposalCitation[]>> {
  const byEntity = new Map<string, ProposalCitation[]>();
  if (entityIds.length === 0) return byEntity;

  const rows = (await AppDataSource.query(PROPOSAL_CITATIONS_SQL, [
    entityIds,
    PROPOSAL_SAMPLE_ARTICLES,
  ])) as ProposalCitationRow[];

  for (const row of rows) {
    const citation: ProposalCitation = {
      entityId: row.entityId,
      id: row.id,
      title: row.title,
      url: row.url,
      publishedAt: row.publishedAt,
      story: storyOf(row),
    };
    const held = byEntity.get(row.entityId);
    if (held) held.push(citation);
    else byEntity.set(row.entityId, [citation]);
  }
  return byEntity;
}
