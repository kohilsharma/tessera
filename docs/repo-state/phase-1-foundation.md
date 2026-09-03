# Phase 1 — Foundation

Schema, auth, RBAC, the seeded corpus, Briefs and hybrid search. Rubric-complete on its own (ADR-0022).

**backend/** — Express + TypeORM. Auth (#17), role-guard middleware + dashboards (#18), a
seeded Publisher/Story/Article corpus with browse endpoints (#19), IntelligenceBrief CRUD with
cover images (#20, #21), hybrid search over the corpus (#22 — Postgres FTS + pgvector cosine,
fused by RRF), and Phase-1 demo hardening (#23 — finalized Compose, hosted EmbeddingProvider,
a seeded owned Brief) are live; `GET /api/v1/health` from the walking skeleton (#16) too.
