# 7. Ingestion guardrail: timebox + fixtures fallback

Date: 2026-07-25
Status: Accepted
Depends on: ADR-0006

## Context

ADR-0006 accepted building the full live acquisition pipeline before the flagship, which
re-introduces the risk of starving the flagship (ADR-0001/0002). That risk is only
acceptable with a hard guardrail.

## Decision

1. **Timebox.** The acquisition pipeline gets a fixed window (~2 weeks). At the deadline,
   whatever works ships; unfinished dedup layers (SimHash/MinHash) and rights-policy polish
   move *behind the connector interface* as later work. The flagship starts on schedule
   regardless of ingestion completeness.

2. **Fixtures fallback (always built).** A deterministic fixture loader seeds 8-12
   multi-source Stories (each with ≥2 publishers and real snippets). The graded **demo runs
   on fixtures**, not live feeds — reproducible, always multi-source, immune to network/feed
   flakiness and empty-query results. Live connectors prove ingestion works; fixtures
   guarantee the demo and feed the flagship.

## Consequences

- The demo cannot break due to live-feed behavior (satisfies v3 §24.5).
- The flagship always has clean multi-source data to consume on day one of its phase.
- Live ingestion completeness becomes a "nice to have" at the deadline, not a blocker.
