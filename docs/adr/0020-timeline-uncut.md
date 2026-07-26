# 20. Timeline un-cut: Story-evolution query + view (supersedes the timeline cut in ADR-0011)

Date: 2026-07-26
Status: Accepted
Supersedes: the "timeline change-detection cut" of ADR-0011 (monitoring stays cut)
Depends on: ADR-0009 (Stories), ADR-0018 (ingestion timestamps)

## Context

ADR-0011 cut the timeline together with the TrackedTopic/Notification monitoring product,
conflating two different things. The user wants the timeline (it was half of the original
moat). Re-examined, the timeline is **not** a new subsystem: a Story already clusters Articles
(ADR-0009), and every Article carries a `seendate`/published timestamp (ADR-0018). A Story's
timeline is just *its evidence ordered over time* — a query and a visualization over data that
already exists, not a new extraction or change-detection engine.

The expensive thing ADR-0011 rightly cut — **"notify me what changed" change-detection +
diffing + delivery** — stays cut. That is the monitoring mini-product, and it is separable
from simply *showing* a Story's evolution.

## Decision

- **Build the timeline as a read view over existing data:** a Story's Articles (and the
  EvidenceSets/Briefs generated from it) ordered on a time axis, with tone/volume overlays
  available for free from GKG fields (ADR-0018).
- **No change-detection, no diffing, no notifications** — those remain deferred with the
  monitoring product (ADR-0011 still governs that cut).
- Optional `TimelineNode` materialization only if a query proves too slow; default is a live
  query. Keep it a projection, not a source of truth.
- **Sequencing:** ships in **Phase 3.5** alongside the knowledge graph (ADR-0022); both are
  read views over the same substrate.

## Consequences

- A visually strong "how this story evolved" view for near-zero incremental cost.
- Reinforces the evidence model: each timeline point ties back to Articles/EvidenceSets.
- Clear boundary preserved: showing evolution ≠ monitoring/alerting (still cut).
