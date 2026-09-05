# 37. Clean seed includes a graph demo substrate

Date: 2026-09-05
Status: Accepted
Depends on: ADR-0019 (Postgres graph), ADR-0022 (Phase 3.5 exit criterion), ADR-0029 (Curated Corpus)

## Context

The Curated Corpus contains 137 hand-authored annotations, but its names occur in only two or
three Articles. The production Entity Promotion Floor is five distinct Articles, so a clean
`npm run seed` left `/graph` empty even though the graph resolver succeeded. Waiting for live
GDELT ingestion made the demo depend on network timing and contradicted the Phase 3.5 fallback.

## Decision

The seed now adds five unclustered `manual_fixture` Articles with six repeated annotations, then
runs the normal `runEntityResolution` seam. These rows are not assigned to Stories, are retained
with the Curated Corpus, and are embedded like every other seeded Article. No threshold is lowered,
no Entity or edge is inserted directly, and the worker's live path is unchanged.

## Consequences

- A fresh seed produces a small, cited co-occurrence graph immediately.
- The graph remains an honest firehose-style view: its demo rows are unclustered and their
  citations open as Articles without Story membership.
- The fixture names and reports are synthetic and labelled by their `manual_fixture` mode; live
  ingestion still grows the rolling graph when the worker runs.
