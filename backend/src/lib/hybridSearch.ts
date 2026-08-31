import { AppDataSource } from "../data-source";
import { toVectorLiteral } from "../embeddings/pgvector";
import type { EmbeddingProvider } from "../embeddings/EmbeddingProvider";
import type { ParsedListQuery } from "./listQuery";

// ADR-0014: standard RRF constant (also Elasticsearch's default) — large enough
// that a single signal's rank-1 doesn't dominate the sum, small enough that
// rank still matters more than raw presence.
const RRF_K = 60;

// ponytail: fixed ANN candidate pool, retrieved *before* the category/date
// filters below. pgvector's HNSW index only kicks in with an ORDER BY ... LIMIT,
// so semantic ranking has to cap somewhere; the cost is that a filter can
// exclude an article that would otherwise qualify but ranked outside this pool
// on raw cosine distance. Fine at fixture/demo scale — revisit with a larger
// pool or filtered ANN once the corpus grows past low hundreds.
const SEMANTIC_CANDIDATE_POOL = 500;

// The nearest neighbours of a query are only *relevant* neighbours if they're
// actually close: ANN always returns its k nearest, however far away they are,
// so without a cutoff a nonsense query fuses in the whole corpus and "nothing
// matched" becomes unreachable. `<=>` is cosine distance (0 identical, 1
// orthogonal), so 0.6 keeps neighbours above ~0.4 cosine similarity.
// ponytail: one hand-set threshold, not a per-query or learned one — this is a
// calibration knob, and the right value depends on the serving model, so retune
// it when the hosted provider replaces Mock (#23) rather than trusting 0.6.
const SEMANTIC_MAX_DISTANCE = 0.6;

export type HybridSearchSortBy = "relevance" | "publishedAt";

// Search takes the shared list contract (lib/listQuery.ts) whole and only
// narrows `sortBy` to the two fields it can actually order by, so the filter
// and pagination shapes can't drift apart from the other list endpoints.
export type HybridSearchFilters = ParsedListQuery<HybridSearchSortBy>;

export type HybridSearchHit = { id: string; score: number };

export type HybridSearchResult = {
  hits: HybridSearchHit[];
  total: number;
};

type FusedRow = { articleId: string | null; score: string | null; totalCount: string };

// Lexical (tsvector/GIN) and semantic (pgvector cosine/HNSW) are each ranked
// independently, then fused by Reciprocal Rank Fusion (sum(1/(k+rank))) —
// avoids normalizing two differently-scaled signals onto one axis (ADR-0014).
// Category/date filters and sort/pagination apply to the fused set, not to
// either signal alone. Returns ids + scores only; the caller hydrates full
// Article entities (with relations, redistribution gating) via the normal
// repository.
// ADR-0023: a hosted provider is a network dependency, and the seeded demo has
// to stay usable when it rate-limits or the network drops. A failed embed costs
// the semantic signal, not the request — lexical still answers the query, which
// is a visibly worse result but a working one. Rethrowing here would turn every
// Gemini 429 into a 500 on GET /search.
async function embedQueryOrNull(
  queryText: string,
  embedder: EmbeddingProvider,
): Promise<string | null> {
  try {
    return toVectorLiteral(await embedder.embed(queryText, "query"));
  } catch (err) {
    console.warn("[search] embedding failed, falling back to lexical-only results:", err);
    return null;
  }
}

export async function hybridSearchArticleIds(
  queryText: string,
  filters: HybridSearchFilters,
  embedder: EmbeddingProvider,
): Promise<HybridSearchResult> {
  const queryVector = await embedQueryOrNull(queryText, embedder);
  const sortColumn = filters.sortBy === "relevance" ? "score" : `"publishedAt"`;
  const sortDir: "ASC" | "DESC" = filters.sortDir === "asc" ? "ASC" : "DESC";
  const offset = (filters.page - 1) * filters.pageSize;

  const rows: FusedRow[] = await AppDataSource.query(
    `
    WITH lexical AS (
      -- ADR-0014: lexical over "Article/Story text" — an Article's own words or
      -- its parent Story's (title/summary) either one counts as a match, ranked
      -- by their combined ts_rank (a generated column can't span both tables in
      -- one tsvector, so Article and Story each carry their own).
      SELECT a.id, ROW_NUMBER() OVER (
        ORDER BY ts_rank(a."searchVector", query) + COALESCE(ts_rank(st."searchVector", query), 0) DESC, a.id ASC
      ) AS rank
      FROM articles a
      JOIN stories st ON st.id = a."storyId", plainto_tsquery('english', $1) AS query
      WHERE a."searchVector" @@ query OR st."searchVector" @@ query
    ),
    semantic AS (
      -- The ANN scan is the inner query and nothing but ORDER BY ... LIMIT, so
      -- the HNSW index can serve it; ranking and the distance cutoff sit
      -- outside it. Inlining either one would force a window function or a
      -- filter over the whole table first and turn this back into a seq scan.
      SELECT id, ROW_NUMBER() OVER (ORDER BY distance, id ASC) AS rank
      FROM (
        SELECT id, embedding <=> $2::vector AS distance
        FROM articles
        -- $2 is NULL when the embedding provider is unreachable: the CTE goes
        -- empty and RRF degrades to lexical-only (see embedQueryOrNull).
        WHERE embedding IS NOT NULL AND "storyId" IS NOT NULL AND $2::vector IS NOT NULL
        ORDER BY embedding <=> $2::vector
        LIMIT ${SEMANTIC_CANDIDATE_POOL}
      ) nn
      WHERE distance <= ${SEMANTIC_MAX_DISTANCE}
    ),
    fused AS (
      SELECT COALESCE(l.id, s.id) AS "articleId",
             COALESCE(1.0 / (${RRF_K} + l.rank), 0) + COALESCE(1.0 / (${RRF_K} + s.rank), 0) AS score
      FROM lexical l
      FULL OUTER JOIN semantic s ON l.id = s.id
    ),
    filtered AS (
      SELECT f."articleId", f.score, a."publishedAt"
      FROM fused f
      JOIN articles a ON a.id = f."articleId"
      JOIN stories st ON st.id = a."storyId"
      WHERE ($3::varchar IS NULL OR st.category = $3)
        AND ($4::timestamptz IS NULL OR a."publishedAt" >= $4)
        AND ($5::timestamptz IS NULL OR a."publishedAt" <= $5)
    )
    -- The count is its own scalar row, LEFT JOINed to the page rather than
    -- carried on them: COUNT(*) OVER() rides along on result rows, so a page
    -- past the end returns none and the total silently reads back as 0.
    SELECT page."articleId", page.score, total.n AS "totalCount"
    FROM (SELECT COUNT(*) AS n FROM filtered) total
    LEFT JOIN LATERAL (
      SELECT * FROM filtered
      ORDER BY ${sortColumn} ${sortDir}, "articleId" ASC
      LIMIT $6 OFFSET $7
    ) page ON TRUE
    `,
    [
      queryText,
      queryVector,
      filters.category ?? null,
      filters.dateFrom ?? null,
      filters.dateTo ?? null,
      filters.pageSize,
      offset,
    ],
  );

  return {
    hits: rows
      .filter((r): r is FusedRow & { articleId: string; score: string } => r.articleId !== null)
      .map((r) => ({ id: r.articleId, score: Number(r.score) })),
    total: Number(rows[0].totalCount),
  };
}
