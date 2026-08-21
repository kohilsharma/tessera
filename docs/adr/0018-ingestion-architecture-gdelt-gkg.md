# 18. Ingestion architecture: GDELT GKG firehose + DOC API + RSS + Readability

Date: 2026-07-26
Status: Accepted
Refines: ADR-0006 (full live ingestion first), ADR-0007 (timebox + fixtures)

## Context

ADR-0006 committed to full live ingestion but left the concrete source mix open. Research
(2026-07-26, primary sources: gdeltproject.org, GKG V2.1 codebook, vendor pricing pages)
established the economics: GDELT is free/open with no key and no commercial restriction on
its metadata, and its **GKG (Global Knowledge Graph)** already runs NLP over every monitored
article, emitting persons, orgs, locations, themes, tone, quotations, counts, and amounts —
the exact entity/theme layer we would otherwise have to build ourselves. Most commercial
"news APIs" are non-commercial or dev-only on their free tiers (GNews, NewsAPI.org) and none
return article bodies for free.

## Decision

Ingestion stack, all $0/month:

1. **GKG 2.1 raw 15-minute files = the backbone.** Poll
   `http://data.gdeltproject.org/gdeltv2/lastupdate.txt`, download the `gkg` zip (optionally
   `export`+`mentions` for CAMEO events later), unzip, parse tab-delimited rows, upsert into
   Postgres. This is the **shared entity/theme substrate for both Story clustering (ADR-0009)
   and the knowledge graph (ADR-0019)** — no NLP pipeline of our own.
2. **GDELT DOC 2.0 API** for on-demand keyword / `theme:` / tone search (last ~3 months,
   RSS/JSON, 250-record cap). Send a browser-like `User-Agent` and throttle (~1 req / few sec)
   or it blocks. Unauthenticated.
3. **Curated RSS/Atom feeds** for breadth, freshness, and free full text where publishers
   syndicate `content:encoded`.
4. **Full-text via `@mozilla/readability`** (native Node) extracting the linked page for
   Articles where only a URL/snippet exists — **internal analysis only**.

## Constraints this bakes in

- **GKG persons/orgs are surface name strings, NOT canonical IDs** — entity resolution is our
  job (ADR-0019). GKG locations *are* geo-disambiguated (FeatureIDs) — free.
- **GKG relationships = co-occurrence with character offsets, not typed triples.** Graph edges
  are "co-mentioned," not "acquired/sued/partnered" (typed relations deferred, ADR-0019).
- **No article body from GDELT or most APIs** — headline + snippet + URL only. This is why
  CONTEXT.md's *Analysis Text Mode* exists: a claim must respect the weakest text mode in its
  EvidenceSet.
- **Licensing:** GDELT metadata is open; article *bodies* stay copyrighted. Store extracted
  text for internal, transient analysis (enrichment, embeddings); never redistribute full
  bodies. Per-source `terms_class` gates storage. Guardian Open Platform (full text, free) is
  non-commercial + attribution — usable for seed fixtures, not the product foundation.

## Consequences

- Rich entity/theme structure at zero cost, feeding clustering, hybrid search, and the graph.
- The Phase-2 ingestion work (ADR-0022) doubles as the graph's data source — no duplication.
- The 15-min poll loop + zip parse + upsert is the core connector; RSS and DOC are secondary.
- BigQuery is explicitly avoided (a single GKG year is ~2.5TB; raw files are free).
- ⚠️ `gdeltcloud.com` is a separate paid third party — do not confuse it with official GDELT.
- **Feed curation is the cheapest lever on text quality.** Readability is the primary body
  source and fails predictably (paywalls, JS-rendered pages, consent walls, bot blocks), so
  the curated RSS list should deliberately favour feeds that emit `content:encoded`. This is
  data curation, not code — no connector, no dependency.
- Evaluated and rejected 2026-08-21: **Currents API**. Verified against current sources — it
  returns metadata only (title, description, URL, source, published time, language, category),
  not article bodies. RSS `content:encoded` + Readability already cover this strictly better.
- Embeddings are a **documented exception** to the internal-only rule above: bodies are sent
  to the hosted embedding provider (ADR-0023). Synthesis evidence text is not — that goes to
  the paid, contractually no-training provider (ADR-0003).
