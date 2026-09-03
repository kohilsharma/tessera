# 24. Analysis Text Mode is an ordered ladder; connector overlap enriches, never duplicates

Date: 2026-08-30
Status: Accepted — the ladder, the one-way rule and enrichment-over-duplication are all unchanged.
What each rung may be **served** under is **superseded by ADR-0032**, whose one correction to this
document is that `api_content` is servable where a Publisher's class clears it. Item 2's
"`metadata_only` is never redistributable" stands as written — that rung holds no text to serve.
Depends on: ADR-0007 (timebox + fixtures), ADR-0018 (GKG ingestion), ADR-0022 (build order)

## Context

Phase 2 (ADR-0022) turns two very different instruments loose on the same web: a curated RSS
list, which yields a complete Article with an excerpt, and the GDELT GKG firehose, which is
the entity/theme substrate for clustering (ADR-0009) and the graph (ADR-0019).

Measured against a live GKG window (`20260830144500`, 2026-08-30): 656 rows, 8.26 MB
uncompressed, 27 tab-separated fields, 163 distinct source domains. `<PAGE_TITLE>` is present
in 656/656 rows inside `V2EXTRASXML`. **There is no body and no snippet in GKG at all**, and
field 18 (GCAM) alone is 71.5% of the bytes.

Two problems fall out of that, and they interact.

**1. A GKG row makes an Article with no text.** It must make one: `EntityEdge` carries
`source_article_id` and an uncited edge is a bug (ADR-0019), so entities need an Article to
point at. Staging entities without creating Articles would limit the graph to URLs the
curated feeds independently found — against GKG's long tail, near-zero overlap, and the graph
starves. But a title-only Article fits none of the four existing Analysis Text Modes, and
`feed_excerpt` is the tempting lie: it would let Phase-3 synthesis build a cited claim on a
bare headline while believing it held an excerpt, which is the exact failure the Analysis
Text Mode concept exists to prevent.

**2. Both connectors will constantly hit the same URL.** Under a flat "same canonical URL is
a duplicate, reject it" rule (the obvious reading of ADR-0007's dedup layers), whichever
connector arrives second is discarded — and each carries what the other lacks. GKG first,
RSS second: the real excerpt is thrown away and the Article is stuck text-less forever. RSS
first, GKG second: the entities are thrown away and that article contributes nothing to the
graph. Both orderings destroy data, and which one occurs is a race.

## Decision

1. **Analysis Text Mode is an ordered ladder**, weakest first:
   `metadata_only` < `feed_excerpt` < `api_content` < `licensed_full_text`.
   `manual_fixture` sits outside it (our own synthetic seed text, ADR-0007).
2. **`metadata_only` is a new weakest rung**: title and metadata, no analysable text.
   `analysisText` becomes nullable to hold this honestly — storing the title in it would
   reproduce the lie the rung was added to prevent. It is never redistributable, and never
   sufficient evidence for a claim on its own.
3. **An Article's mode only ever moves up the ladder, never down.**
4. **Same canonical URL across connectors is enrichment, not duplication.** Attach the GKG
   Annotations; raise the text mode if the newcomer is stronger. Duplication means the same
   reporting at a *different* URL (normalized title + publisher + date), which is rejected
   and counted as before.
5. **`IngestionRun` therefore counts `enrichedCount` separately** from `insertedCount` and
   `duplicateCount`.

## Consequences

- Phase-3 citation validation can rely on the ordering being real: "the weakest mode in this
  EvidenceSet" is now a computable minimum over a total order, not a judgement call.
- `articles.searchVector` is a generated column over `to_tsvector('english', "analysisText")`
  with no `coalesce`. Since `tsvector || NULL` is NULL in Postgres, making the column nullable
  **must** rewrite that expression in the same migration or every ingested Article silently
  vanishes from search. `stories.summary` two lines below already shows the pattern.
- `analysisText` becomes `string | null` in TypeScript, so the compiler forces every consumer
  to decide what an Article with no text means. This is the point.
- Reporting a GKG/RSS overlap as either an insert or a duplicate would be a lie about what
  happened; the third counter is what makes the Admin ingestion view truthful.
- Syndicated wire copy — one AP story under ten mastheads — is deliberately left alone here.
  It is ten legitimate `source_article_id`s for the co-occurrence graph and one source for
  consensus synthesis; resolving that tension belongs to Phase 3's evidence weighting, and
  baking it into Phase-2 row identity would fix it wrongly and early. SimHash/MinHash stays
  deferred behind the connector interface, as ADR-0007 pre-authorised.
- GCAM is dropped at parse time and never stored: 71.5% of the bytes for a field nothing in
  ADR-0019 or ADR-0020 reads. The tone the timeline wants is field 16, which is tiny and stays.
