# 28. The knowledge graph is firehose-derived and rolling, not Story-scoped (corrects ADR-0019)

Date: 2026-09-01
Status: Accepted
Depends on: ADR-0018 (GKG ingestion), ADR-0019 (bounded GKG-backed graph), ADR-0024 (text-mode
ladder), ADR-0026 (clustering)
Corrects: ADR-0019's "the graph is **scoped to the Story/Brief in view**" clause

## Context

ADR-0019 decided the graph is bounded and curated, and scoped each view to the Story or Brief
being read. That scoping assumed GKG Annotations would be available on the Articles a Story is
made of. They are not, and the reason is structural rather than a defect to fix.

Annotations are staged against the Articles a GKG connector discovers. Those rows are
`metadata_only` (ADR-0024), which makes them ineligible for clustering (ADR-0026) and eligible
for the Retention Window. An annotation reaches a Story member only by cross-connector
enrichment: GKG and an RSS feed landing on the same canonical URL.

Measured on 2026-09-01, one 15-minute GKG window against all ten seeded RSS feeds:

| | |
|---|---|
| GKG Articles inserted | 968, all `metadata_only` |
| RSS Articles inserted | 210, all `feed_excerpt` |
| **Cross-connector enrichments** | **0** |
| Annotation occurrences | 66,229 (68.4 per Article) |

Not one GKG row came from any of the ten feed domains — bbc.co.uk 0, wsj.com 0, npr.org 0, and
so on for all ten. This is not a canonical-URL normalization bug. A GKG window carries ~1,000
documents drawn from ~63k domains worldwide; ten curated feeds publish a couple of hundred a
day. The two sets meeting is a coincidence that mostly does not happen.

A Story-scoped graph is therefore an empty graph, and would stay empty however long the
connectors run.

## Decision

- **Entities resolve from every annotated Article**, not only from Story members. The graph's
  substrate is the firehose, which is where all 66,229 occurrences live.
- **The graph is not scoped to a Story.** Its front door is one bounded global view (the
  entities most present in the retained window); its detail view is entity-centric — one
  Entity's neighbourhood, each edge opening the Articles it is cited to.
- **The graph is a rolling window, and says so.** An EntityEdge cites its source Article and
  dies with it, so the firehose-derived half of the graph turns over every seven days
  (ADR-0024's Retention Window). Edges cited to Articles the corpus kept — clustered, enriched,
  or curated — are permanent.
- **Entities are promoted on merit.** A surface name becomes an Entity only once it clears a
  frequency floor; below it, it stays an unresolved annotation and expires with its Article.
  One window yields 2,044 distinct person names but only 133 seen in five or more Articles;
  person and organization together at that floor give 195 nodes, which is ADR-0019's 50–200
  bound arriving from the data rather than from a guess.
- **Edges are bounded per node**, strongest co-occurrences first. 195 nodes carry 4,833 pairs
  sharing two or more Articles — bounded nodes do not imply a bounded picture, and ADR-0019
  bounded only nodes.
- **Themes are not Entities.** They are 46,787 of the 66,229 occurrences over 2,072 controlled
  vocabulary values — roughly 48 per Article, so theme-to-theme co-occurrence is close to a
  complete graph and carries no information. Themes become a facet the graph and timeline are
  filtered by.

## Consequences

- The graph and the timeline read different corpora: the timeline shows curated, clustered
  reporting through Story membership, the graph shows the retained firehose. This is stated in
  the product rather than hidden — a graph labelled as the last seven days of global coverage
  is honest, and one that silently mixes the two would not be.
- A graph screenshot is not reproducible a fortnight later. Hand-annotating the Curated Corpus
  (ADR-0029) is what keeps the demo path immune to what GDELT published that morning.
- ADR-0019's rejection of a "broad cross-Story firehose graph" stands in spirit and is
  corrected in letter: the risk it named — thousands of noisy, half-duplicated nodes — is
  answered by the promotion floor and the per-node edge bound, not by Story scoping.
