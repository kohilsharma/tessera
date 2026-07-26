# 9. Story clustering: batch job + Admin review + fixture Stories

Date: 2026-07-25
Status: Accepted
Depends on: ADR-0007 (fixtures), ADR-0008 (embeddings)

## Context

Story clustering feeds the flagship (ADR-0002): no clean multi-source Stories → nothing to
synthesize. v3 implies online/incremental clustering with tuned similarity thresholds.
Clustering thresholds are notoriously fiddly and data-dependent: too tight yields singleton
Stories (no multi-source evidence), too loose merges unrelated articles (synthesis produces
nonsense). Tuning this on live heterogeneous news is an unbounded time sink, and the
flagship's demo quality rides on it.

Key reframe: the flagship needs *a reliable set of clean multi-source Stories*, not a
great general-purpose online clusterer. Those are different problems; fixtures (ADR-0007)
already guarantee the clean set.

## Decision

- **Batch clustering job** (not online): embed articles (ADR-0008), group by cosine
  similarity above a tuned threshold within a time window, persist clusters as Stories.
  Runs over live-ingested articles to prove the algorithm works.
- **Fixtures are hand-authored into known-good Stories** so the demo is guaranteed clean and
  reproducible regardless of clustering quality on live data.
- **Admin review**: Admin can inspect clusters and merge/split borderline ones — real
  RBAC-gated business logic and a strong viva/demo artifact.

## Consequences

- Clustering complexity is bounded (a schedulable batch job, not a realtime state machine).
- Demo quality is decoupled from live-clustering accuracy.
- Online/incremental clustering remains a documented later evolution behind the same
  Story-assignment path.
- Threshold config is a tunable, not a correctness dependency for the demo.
