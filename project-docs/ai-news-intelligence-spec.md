# AI News Intelligence Platform — Technical Specification

**Version:** 0.1 (draft)
**Date:** 2026-07-14
**Scope:** Production consumer platform — broad news coverage, public SEO-friendly site, real-time updates, built to scale.
**Data sourcing:** Free / open feeds (RSS/Atom, GDELT, open news APIs, Wikidata).

---

## 1. Product Overview

An AI-powered news intelligence platform that ingests news at scale, extracts entities and events, and presents two flagship reader-facing features backed by a shared knowledge layer:

- **Story Timelines** — related articles are clustered into a single evolving *story*, with key developments laid out chronologically and deduplicated across outlets.
- **Connected Entity Graphs** — people, organizations, places, and events are extracted and rendered as an interactive graph, with every edge traceable to the article that asserts it.

### 1.1 Product principles

- **Every claim is cited.** No graph edge or timeline node exists without a source article behind it, with a confidence score.
- **Multi-source by default.** Timeline nodes and entity relationships aggregate multiple outlets to counter single-source bias.
- **Freshness matters.** Breaking stories update in near real time; timelines and graphs reflect new developments within minutes.
- **SEO-first public surface.** Story and entity pages are server-rendered, canonical, and crawlable — organic search is the primary growth channel for a consumer product.

### 1.2 Non-goals (v1)

- Editorial opinion or original reporting — we aggregate and structure, we do not author news.
- Full-text republishing — snippets + link-out only (see §9 licensing).
- Personalized feed/recommendation engine — deferred to a later phase.

---

## 2. System Architecture

```
                          ┌──────────────────── message queue (Kafka) ────────────────────┐
                          │                                                                 │
┌─────────────┐   ┌───────▼──────┐   ┌──────────────┐   ┌─────────────────┐   ┌────────────▼──┐
│  Ingestion  │──▶│  Normalize   │──▶│  Processing  │──▶│  Knowledge      │──▶│  API layer    │
│  workers    │   │  + dedup     │   │  pipeline    │   │  store          │   │  (FastAPI)    │
│ (RSS/GDELT/ │   │              │   │  (NLP + LLM) │   │ (PG+Neo4j+vec)  │   │               │
│  crawlers)  │   │              │   │              │   │                 │   │               │
└─────────────┘   └──────────────┘   └──────────────┘   └─────────────────┘   └───────┬───────┘
                                                                                        │
                                                                             ┌──────────▼─────────┐
                                                                             │  Web frontend      │
                                                                             │  (Next.js, SSR)    │
                                                                             └────────────────────┘
```

Every stage communicates through a durable queue so ingestion spikes don't overwhelm processing, and processing can be scaled and retried independently.

### 2.1 Layer responsibilities

| Layer | Responsibility |
|---|---|
| Ingestion | Poll feeds, crawl allowed sources, emit raw article payloads |
| Normalize + dedup | Canonical schema, language detection, near-duplicate collapse of wire reprints |
| Processing | NER, entity resolution, relation/event extraction, embeddings, story clustering, summarization |
| Knowledge store | Persist articles, stories, entities, relationships, timeline nodes, vectors |
| API | Serve timelines, entity subgraphs, search; enforce caching |
| Frontend | SSR story/entity pages, interactive timeline + graph views |

---

## 3. Data Sources (free / open)

| Source | Type | Notes |
|---|---|---|
| RSS / Atom feeds | Per-outlet | Broadest free coverage; per-source parsing quirks |
| GDELT Project | Global event DB | Massive scale, structured events, 15-min updates, permissive terms |
| Common Crawl | Web archive | For backfill / historical crawl at scale |
| Wikidata / Wikipedia | Knowledge base | Ground truth for entity resolution + enrichment |
| Outlet public APIs | Per-outlet | Where free tiers exist (e.g. Guardian Open Platform) |

**Ingestion policy:** honor `robots.txt`, respect per-source rate limits and `Retry-After`, identify with a descriptive User-Agent, and record source terms per outlet in a `sources` registry. Prefer link-out over full-text storage (see §9).

---

## 4. Data Model

### 4.1 Relational (PostgreSQL)

```
Source        (id, name, homepage, feed_url, terms_class, rate_limit, robots_ok, active)
Article       (id, source_id, url [unique], canonical_url, title, snippet,
               body_ref, language, published_at, fetched_at, author,
               content_hash, simhash, embedding [pgvector], story_id, dedup_of)
Story         (id, title, summary, first_seen, last_updated, article_count,
               primary_entities [], status)      -- status: active | dormant
TimelineNode  (id, story_id, event_time, headline, summary, node_type, confidence)
NodeArticle   (node_id, article_id, is_primary)  -- many articles per node
Entity        (id, canonical_name, type, wikidata_id, aliases [], description,
               embedding [pgvector], article_count, first_seen, last_seen)
EntityMention (id, article_id, entity_id, surface_text, offset, confidence)
```

- `content_hash` = exact-dup detection; `simhash` = near-dup (wire reprints).
- `body_ref` points to object storage (S3/GCS) or is null when licensing forbids storing full text — snippet only.
- `embedding` on both Article and Entity powers clustering, semantic search, and entity resolution.

### 4.2 Graph (Neo4j)

```
(:Entity {id, canonical_name, type, wikidata_id})
(:Story  {id, title})

(:Entity)-[:RELATES {predicate, confidence, event_time,
                     source_article_id, source_story_id}]->(:Entity)
(:Entity)-[:APPEARS_IN {role, confidence}]->(:Story)
```

Relationship (edge) invariants:
- Always carries `source_article_id` — an edge with no citable article is a bug.
- Carries `confidence` in `[0,1]` and `event_time` so the graph can be time-sliced.
- `predicate` from a controlled vocabulary (e.g. `acquired`, `appointed`, `sued`, `partnered_with`, `invested_in`, `located_in`) plus a free-text `raw_predicate` fallback.

### 4.3 Vector store

pgvector inside PostgreSQL for v1 (one system to operate). Store article and entity embeddings; HNSW index for ANN search. Migrate to a dedicated vector store only if recall/latency at scale demands it.

---

## 5. Processing Pipeline

Async workers consuming from the queue, each stage independently scalable.

### 5.1 Normalization + deduplication
1. Parse to canonical schema, detect language (skip/branch non-target languages).
2. Exact dedup via `content_hash`.
3. Near-dup via SimHash/MinHash within a time window → collapse reprints, keep earliest as canonical, link others via `dedup_of`.

### 5.2 Entity extraction (NER)
- Baseline: spaCy / transformer NER for people, orgs, locations, products.
- Escalate low-confidence or novel spans to an LLM for typing and boundary correction.

### 5.3 Entity resolution *(highest-risk component)*
- Candidate generation via alias table + embedding ANN + Wikidata lookup.
- Disambiguation via embedding similarity + contextual features (co-occurring entities, source, date).
- LLM adjudication for ambiguous merges; write `wikidata_id` when confidently linked.
- **Guardrail:** a wrong merge pollutes both the timeline and the graph. Require a confidence threshold to auto-merge; queue borderline cases for review. Track precision/recall on a labeled test set as a release gate.

### 5.4 Relation / event extraction
- LLM extracts structured triples `(subject, predicate, object)` with confidence and the supporting sentence span.
- Map predicates to controlled vocabulary; retain raw predicate.
- Every triple stored with `source_article_id` and the evidence span for traceability.

### 5.5 Story clustering
- Represent each article by embedding.
- Assign to an existing active story if similarity + temporal proximity exceed threshold; else seed a new story.
- Stories go `dormant` after N days without new articles; can reactivate.
- Periodic re-clustering pass to merge/split stories as they evolve.

### 5.6 Summarization
- Per-article snippet summary (cheap model, e.g. Haiku).
- Per-timeline-node "what happened" summary aggregating that node's articles.
- Per-story rolling summary (stronger model for the story overview).

### 5.7 Model tiering (cost control)
- Bulk extraction / summarization → cheap fast model.
- Hard disambiguation, story overviews, relation adjudication → stronger model.
- Cache by `content_hash` so re-processing is free; batch LLM calls where possible.

---

## 6. Story Timeline Feature

- **Story page** (`/story/{slug}`): chronological list of `TimelineNode`s, each a meaningful development — not one-per-article.
- Each node aggregates same-event articles with multi-outlet attribution and a synthesized summary.
- **Filters:** date range, outlet, involved entity, node type.
- **"What changed":** diff between consecutive nodes to surface genuinely new information vs. restated context.
- **Cross-links:** entities in a node link to their entity graph page.
- SSR + canonical URL + structured data (`schema.org/NewsArticle`, `BreadcrumbList`) for SEO.

---

## 7. Entity Graph Feature

- **Entity page** (`/entity/{slug}`): focal node with connected entities, edges labeled by predicate.
- **Depth control:** 1-hop / 2-hop expansion, lazy-loaded from the API.
- **Filters:** edge type, time window, minimum confidence.
- **Time scrubbing:** replay how relationships appeared/faded over a chosen window using edge `event_time`.
- **Traceability:** clicking an edge shows the source article(s) and jumps into the relevant story timeline.
- Rendering: Cytoscape.js or react-force-graph; API returns a bounded subgraph (cap node/edge count, paginate expansion) to keep the client responsive.

---

## 8. API Design (FastAPI)

Representative endpoints (all read paths cached at the edge/CDN):

```
GET /search?q=&type=story|entity|article&from=&to=
GET /stories?entity=&from=&to=&sort=recent|active
GET /stories/{id}                         -> story + ordered timeline nodes
GET /stories/{id}/nodes/{node_id}         -> node detail + source articles
GET /entities/{id}                        -> entity profile + top relationships
GET /entities/{id}/graph?depth=&types=&from=&to=&min_confidence=
GET /entities/{id}/timeline               -> stories this entity appears in
GET /articles/{id}                        -> metadata + snippet + link-out
```

- Cursor pagination on all list endpoints.
- Graph endpoint enforces node/edge caps and returns an `expandable` flag per node.
- ETag + `Cache-Control`; invalidate on story/entity update via cache tags.

---

## 9. Licensing & Compliance

- **Store snippets + link out**, not full article text, unless a source's terms explicitly permit republication. Record `terms_class` per source and enforce it in the storage layer.
- Honor `robots.txt`, crawl-delay, and rate limits; back off on `429`/`Retry-After`.
- Attribute every node and edge to its source outlet with an outbound link.
- Provide a takedown / correction pathway.
- GDELT and Common Crawl carry permissive terms suitable for derived structured data — prefer them for scale.

---

## 10. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Ingestion / workers | Python | Best NLP/ML ecosystem |
| Queue | Kafka (or SQS on AWS) | Decouple + backpressure |
| NER | spaCy / transformers + LLM escalation | Cost/accuracy balance |
| LLM | Claude, tiered (Haiku bulk / Opus hard cases) | Extraction + summarization |
| Relational + vector | PostgreSQL + pgvector | One system for metadata + ANN |
| Graph | Neo4j | Purpose-built traversal |
| Object storage | S3 / GCS | Raw payloads where permitted |
| API | FastAPI | Async, Python-native |
| Frontend | Next.js + React (SSR) | SEO on public pages |
| Graph viz | Cytoscape.js / react-force-graph | Interactive entity graph |
| Timeline viz | vis-timeline or D3 | Flexible chronological layout |
| Infra | Containers + orchestrator, CDN in front of API + web | Scale + edge caching |

---

## 11. Non-Functional Requirements

- **Freshness:** breaking-story articles visible in structured views within ~5 minutes of publication.
- **Availability:** public read surface targets high availability; ingestion/processing can degrade gracefully (queue buffers).
- **Scale:** design for 10k+ articles/day ingest in v1, headroom to 100k+.
- **Latency:** cached story/entity page < 300ms server response; graph expansion < 500ms.
- **Observability:** per-stage queue depth, processing latency, extraction confidence distributions, entity-resolution precision/recall dashboards.
- **Data quality gates:** entity-resolution and relation-extraction accuracy tracked against labeled test sets; regressions block release.

---

## 12. Key Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Entity resolution errors | Corrupts both timelines and graphs | Confidence thresholds, human review queue, labeled eval gate |
| Hallucinated relationships | False connections erode trust | Ground every edge in evidence span + confidence; never assert uncited edges |
| LLM cost at scale | Unsustainable unit economics | Model tiering, caching by content hash, batching |
| Content licensing | Legal exposure | Snippet + link-out, per-source terms enforcement, prefer open data |
| Single-source bias | Skewed narratives | Multi-outlet aggregation per node/edge |
| Feed heterogeneity | Brittle ingestion | Per-source adapters, canonical schema, dead-feed monitoring |

---

## 13. Phased Roadmap

- **Phase 1 — Ingestion + storage.** Feeds → normalized, deduplicated articles in Postgres. Basic keyword search. *Exit: articles flowing reliably from N sources.*
- **Phase 2 — NLP core.** NER, entity resolution, embeddings, semantic search. *Exit: entity resolution passes accuracy gate on test set.*
- **Phase 3 — Story clustering + timelines.** Clustering pipeline + timeline UI + story pages (SSR/SEO). *Exit: coherent multi-source timelines for live stories.*
- **Phase 4 — Entity graph.** Relation extraction, Neo4j, interactive graph UI with traceable edges. *Exit: cited, time-sliceable entity graphs.*
- **Phase 5 — Scale + polish.** Real-time updates, edge caching, alerts, quality tuning, observability dashboards.

---

## 14. Open Questions

- Target languages / regions for v1 (affects NER models and source selection)?
- Monetization model (ads, subscription, API access) — shapes rate limits and feature gating.
- Human-in-the-loop review capacity for entity resolution — how much manual review is affordable?
- Retention policy for raw article bodies where storage is permitted.
