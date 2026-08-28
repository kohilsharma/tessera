import { AppDataSource } from "../data-source";
import { toVectorLiteral } from "../embeddings/pgvector";
import type { EmbeddingProvider } from "../embeddings/EmbeddingProvider";
import type { SortDir } from "./listQuery";

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

export type HybridSearchSortBy = "relevance" | "publishedAt";

export type HybridSearchFilters = {
  category?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sortBy: HybridSearchSortBy;
  sortDir: SortDir;
  page: number;
  pageSize: number;
};

export type HybridSearchHit = { id: string; score: number };

export type HybridSearchResult = {
  hits: HybridSearchHit[];
  total: number;
};

type FusedRow = { articleId: string; score: string; totalCount: string };

// Lexical (tsvector/GIN) and semantic (pgvector cosine/HNSW) are each ranked
// independently, then fused by Reciprocal Rank Fusion (sum(1/(k+rank))) —
// avoids normalizing two differently-scaled signals onto one axis (ADR-0014).
// Category/date filters and sort/pagination apply to the fused set, not to
// either signal alone. Returns ids + scores only; the caller hydrates full
// Article entities (with relations, redistribution gating) via the normal
// repository.
export async function hybridSearchArticleIds(
  queryText: string,
  filters: HybridSearchFilters,
  embedder: EmbeddingProvider,
): Promise<HybridSearchResult> {
  const queryVector = toVectorLiteral(await embedder.embed(queryText));
  const sortColumn = filters.sortBy === "relevance" ? "f.score" : `a."publishedAt"`;
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
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector, id ASC) AS rank
      FROM articles
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $2::vector, id ASC
      LIMIT ${SEMANTIC_CANDIDATE_POOL}
    ),
    fused AS (
      SELECT COALESCE(l.id, s.id) AS "articleId",
             COALESCE(1.0 / (${RRF_K} + l.rank), 0) + COALESCE(1.0 / (${RRF_K} + s.rank), 0) AS score
      FROM lexical l
      FULL OUTER JOIN semantic s ON l.id = s.id
    )
    SELECT f."articleId", f.score, COUNT(*) OVER() AS "totalCount"
    FROM fused f
    JOIN articles a ON a.id = f."articleId"
    JOIN stories st ON st.id = a."storyId"
    WHERE ($3::varchar IS NULL OR st.category = $3)
      AND ($4::timestamptz IS NULL OR a."publishedAt" >= $4)
      AND ($5::timestamptz IS NULL OR a."publishedAt" <= $5)
    ORDER BY ${sortColumn} ${sortDir}, f."articleId" ASC
    LIMIT $6 OFFSET $7
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
    hits: rows.map((r) => ({ id: r.articleId, score: Number(r.score) })),
    total: rows.length > 0 ? Number(rows[0].totalCount) : 0,
  };
}
