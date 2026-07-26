# 16. Build order: foundation → ingestion → flagship → eval

Date: 2026-07-25
Status: **Superseded by ADR-0022** (inserts Phase 3.5 graph+timeline; role features fold into
the flagship phase). Kept for the decision trail.
Depends on: all prior ADRs; consistent with ADR-0006 (ingestion before flagship)

## Context

Last decision node. Build order determines whether a passing course baseline exists early.
ADR-0006 requires ingestion *before the flagship*; it does not require ingestion before the
rubric foundation. This order honors that while front-loading guaranteed marks.

## Decision

Four sequential phases, each with an exit criterion:

1. **Foundation** (rubric-complete on its own): TypeORM schema + migrations (~17 tables,
   ADR-0012), plain JWT auth (ADR-0013), API-level RBAC with 3 distinct role dashboards
   (ADR-0004), fixtures + seed script (ADR-0007/0015), hybrid search (ADR-0014), all UI
   states. Exit: the app passes every mandatory course requirement by itself.
2. **Ingestion** (timeboxed ~2wk, ADR-0006/0007): RSS + GDELT live connectors, dedup,
   rights, IngestionRun, Admin ingestion dashboard. Exit: real multi-source articles land in
   the DB; timebox hits → remainder goes behind the interface.
3. **Flagship** (ADR-0002/0009/0010): batch clustering → evidence freeze → cited synthesis →
   3 claim types + lens → backend citation validation → owned Brief. Exit: end-to-end cited
   Brief generated and displayed, invalid claims rejected.
4. **Eval harness** (ADR-0011, degradable): clustering precision/recall + generation
   pass-rate over fixtures. Exit: metrics report; if time short, collapses to the sliver.

## Consequences

- A passing, demoable course baseline exists after Phase 1 — de-risks everything.
- The flagship (viva centerpiece) is reached with clean data already seeded.
- Eval is pure upside at the end; it cannot starve the flagship.
