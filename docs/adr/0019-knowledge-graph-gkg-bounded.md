# 19. Knowledge graph un-deferred: GKG-backed, bounded + curated (supersedes the deferral in ADR-0002)

Date: 2026-07-26
Status: Accepted
Supersedes: the "entity graph deferred" decision of ADR-0002 (the cited-synthesis flagship stands)
Depends on: ADR-0018 (GKG ingestion), ADR-0009 (Stories), ADR-0017 (embeddings)

## Context

ADR-0002 deferred the entity/relationship graph on one specific objection: **building entity
extraction + resolution solo is high-risk and demos badly when messy.** That objection assumed
we build the NLP extraction ourselves. Research (ADR-0018) invalidates the assumption: **GDELT
GKG already extracts persons, orgs, locations, and themes from global news, free, every 15
minutes.** The extraction risk is outsourced. The user is explicit that the knowledge graph +
timeline was the original moat and wants it built.

What GKG does **not** solve — and what therefore defines the real remaining work:
- Persons/orgs arrive as **surface name strings**, not canonical IDs → entity resolution is ours.
- Relationships are **co-occurrence**, not typed triples → edges mean "co-mentioned," not "acquired."
- A graph of thousands of noisy, half-duplicated nodes looks *broken* in a viva.

## Decision

Build the knowledge graph, **bounded + curated** (user decision, 2026-07-26), as a companion
to the cited-synthesis flagship — not a replacement for it.

- **Substrate:** GKG persons/orgs/locations/themes (ADR-0018). Locations use GKG FeatureIDs
  directly (already disambiguated).
- **Entity resolution (the load-bearing work):** a canonical `Entity` table + an alias/mention
  map. Name strings resolve to canonical entities via normalization + a confidence threshold;
  borderline merges queue for **Admin review** (reuses the ADR-0009 Admin-review pattern).
  A clean graph of ~50–200 entities beats a 10k-node firehose.
- **Edges:** **co-occurrence only**, each edge carrying its `source_article_id`(s) — an uncited
  edge is a bug. Edge weight = co-mention frequency within a Story/time window.
- **Scope of the view:** the graph is **scoped to the Story/Brief in view**, not "all of GDELT."
- **Storage:** **Postgres** — `entity` + `entity_edge` tables, traversed with recursive CTEs.
  No Neo4j (ops burden for no payoff at this scale). Apache AGE remains an optional later add.
- **Frontend:** a force-graph / Cytoscape view over the bounded node set.
- **Sequencing:** **Phase 3.5** — after the flagship works end-to-end (ADR-0022). Degrades to a
  graph over seeded-fixture Stories if time runs short, and still demos cleanly.

## Explicitly deferred (post-course)

- **Typed relations** (acquired / sued / partnered) — GKG doesn't provide them; they require a
  separate LLM extraction pipeline. Highest moat value, highest risk. Not in the graded build.
- **Broad cross-Story firehose graph** — rejected for the "noisy duplicate nodes" demo risk.

## Consequences

- The moat becomes solo-feasible: ingest a graph, resolve entities, present a bounded view.
- Entity resolution quality is now the make-or-break; it gets real design + an Admin review queue.
- The graph directly powers the investor entity-watchlist feature (ADR-0021) later.
- The cited-synthesis flagship (ADR-0002) remains the primary graded centerpiece; the graph is
  additive and sequenced so it cannot starve it.
