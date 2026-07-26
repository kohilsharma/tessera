# 22. Build order revised: insert Phase 3.5 (graph + timeline) (supersedes ADR-0016)

Date: 2026-07-26
Status: Accepted
Supersedes: ADR-0016 (original four-phase order)
Depends on: ADR-0017–0021

## Context

ADR-0016 set Foundation → Ingestion → Flagship → Eval before the graph/timeline were
re-scoped in. The additions (ADR-0019 graph, ADR-0020 timeline, ADR-0021 role features) must
be sequenced so they never threaten the guaranteed-marks core. The GKG ingestion (ADR-0018)
conveniently doubles as the graph's data source, so ingestion is not duplicated.

## Decision

Revised phase order, each with an exit criterion:

1. **Foundation** (rubric-complete alone): TypeORM schema + migrations, plain JWT + API-level
   RBAC with 3 distinct role dashboards, fixtures + seed, hybrid search, all UI states.
   Exit: passes every mandatory course requirement by itself.
2. **Ingestion** (timeboxed, ADR-0018): GKG 15-min firehose (entity/theme substrate) + DOC API
   + RSS + Readability full-text; dedup, rights/`terms_class`, IngestionRun, Admin dashboard.
   Exit: real multi-source Articles + GKG entities/themes land in Postgres.
3. **Flagship** (ADR-0010 + ADR-0021): batch clustering → evidence freeze → cited synthesis →
   3 claim types + lens → backend citation validation → owned Brief. **Includes** the Student
   flashcard generator, Admin response-tuning surface, and the Investor consensus/contradiction
   view (all generation variants). Exit: end-to-end cited Brief + the three role features work;
   invalid claims rejected.
4. **Phase 3.5 — Knowledge graph + timeline** (ADR-0019/0020): entity resolution over GKG,
   canonical `entity` + co-occurrence `entity_edge` tables, Admin merge/split review, bounded
   Cytoscape graph scoped to a Story/Brief, Story-evolution timeline view. Exit: a clean
   ~50–200-node graph + timeline render for seeded Stories; degrades to fixtures if time short.
5. **Eval harness** (ADR-0011, degradable): clustering precision/recall + generation pass-rate
   + the embedding NDCG@10 check (ADR-0017). Exit: metrics report, or the sliver.

## Consequences

- A passing, demoable course baseline still exists after Phase 1 — de-risks everything.
- The moat (graph + timeline) is reached only after the graded flagship is safe, and is itself
  degradable — it cannot starve the core.
- Ingestion's GKG work is amortized across clustering, search, and the graph.
- Order within a phase stays interface-first so "incremental + fast" doesn't mean sloppy.
