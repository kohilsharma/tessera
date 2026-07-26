# 6. Full live ingestion built first (accepted override of ADR-0001)

Date: 2026-07-25
Status: Accepted (overrides part of ADR-0001)

## Context

ADR-0001 fixed scope as course-first: finish the flagship (cited synthesis, ADR-0002)
end-to-end before startup-only plumbing. The acquisition pipeline (live RSS + GDELT DOC,
layered dedup incl. SimHash/MinHash, per-publisher rights enforcement, IngestionRun
tracking) earns no direct rubric line and sits upstream of the flagship.

The reviewer (Claude) recommended "RSS + fixtures now, GDELT + SimHash later behind the
connector interface" to protect the flagship. The developer twice chose full live ingestion
first anyway.

## Decision

Build the full v3 acquisition pipeline (RSS + GDELT DOC live connectors, layered dedup,
rights policy, IngestionRun) as an early phase, before the synthesis flagship is finished.

## Accepted rationale (developer's call)

- The startup foundation genuinely needs real multi-source ingestion and source diversity
  that fixtures cannot provide.
- Admin ingestion dashboards are a strong, concrete demo of RBAC + operational tooling.
- "We ingest live news from many publishers" is a materially stronger pitch than seeded data.

## Accepted risk

This re-introduces the exact risk ADR-0001 was written to avoid: 2-3 weeks of upstream work
before the flagship gets data, so the flagship (viva centerpiece) could be compressed into
the final weeks and demo half-finished.

## Required mitigations (to keep the override survivable)

- See ADR-0007 (ingestion guardrail): a hard timebox + a fixtures fallback so the demo never
  depends on live feeds, and the flagship cannot be starved.
