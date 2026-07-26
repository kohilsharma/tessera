# 14. Hybrid search: Postgres FTS + pgvector fused via RRF

Date: 2026-07-25
Status: Accepted
Depends on: ADR-0008 (embeddings/vector column)
Satisfies: project-statement §3 (advanced search & filtering)

## Context

The course's "advanced search" line has a low bar (any one of keyword/category/date/
pagination/sorting) but the rubric explicitly rewards system-design depth. Search is the
cheapest place to show depth because the embeddings + pgvector column already exist for
clustering (ADR-0008/0009). v3 specifies hybrid full-text + semantic search.

## Decision

Implement **hybrid search**:
- **Lexical**: Postgres full-text search (`tsvector` + GIN index) over Article/Story text.
- **Semantic**: pgvector cosine similarity over the 384-dim embeddings (ADR-0008).
- **Fusion**: Reciprocal Rank Fusion (RRF) — rank by each signal, combine by
  `sum(1/(k+rank))`. Chosen over weighted score-blending because RRF needs no score
  normalization between two differently-scaled signals (a common source of bugs).
- Plus **category filter, date-range filter, sorting, pagination** on top of the fused set.

## Consequences

- Strong depth signal for near-free incremental cost (vector column already built).
- RRF avoids full-text-vs-cosine score-normalization headaches.
- Filters/sort/pagination apply after fusion; must be covered by indexes (GIN for FTS,
  vector index for ANN, btree for category/date).
- Result relevance is demoable on fixtures deterministically.
