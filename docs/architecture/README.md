# Tessera Architecture

This is the viva-facing architecture record for the shipped Phase 3.6 system. The diagrams are
standalone Archify artifacts; each JSON file is the checked source for the adjacent HTML viewer.

## Diagrams

- [Reader request lifecycle](request-lifecycle.html) ([source](request-lifecycle.sequence.json))
- [Scheduled async pipeline](async-pipeline.html) ([source](async-pipeline.workflow.json))
- [Evidence-centred data model](data-model.html) ([source](data-model.architecture.json))
- [Caching layers](caching-layers.html) ([source](caching-layers.architecture.json))

All four artifacts passed Archify showcase delivery: 9/9 checks, 0 errors and 0 warnings. The
latest automated browser checks passed containment and capture at 1440x900, 1600x1000, 1920x1080
and 2048x1320 in light and dark modes. `visualReview` remains `pending`: that field is reserved
for a human or image-capable perceptual review.

## Request lifecycle

`App.tsx` is only the route table and `api/client.ts` is the single frontend fetch layer. A public
read enters an authenticated Express route, verifies JWT/RBAC, reads Postgres, and returns a bounded
view. Search uses `hybridSearchArticleIds()` in
[backend/src/lib/hybridSearch.ts:70](../../backend/src/lib/hybridSearch.ts:70), combining Postgres
full-text and hosted-vector ranks with reciprocal rank fusion (`RRF_K = 60`). The search route
rejoins Stories before it serializes an item, so an Unclustered Article cannot leak into a reader
surface ([backend/src/routes/search.ts:63](../../backend/src/routes/search.ts:63)).

The shared predicate is [acceptedMembership](../../backend/src/lib/storyMembership.ts:17). Evidence
selection uses the same predicate ([backend/src/generation/evidence.ts:121](../../backend/src/generation/evidence.ts:121));
graph reads are the documented firehose exception and are bounded inside
[loadGraphView](../../backend/src/graph/loadGraphView.ts:17). `buildTimeline()` takes an Article set,
not a query, and returns a computed axis with existing EvidenceSet and GenerationRun events
([backend/src/timeline/buildTimeline.ts:112](../../backend/src/timeline/buildTimeline.ts:112)).

## Async pipeline

The API does not execute Admin jobs inline. Ingestion, clustering and graph resolution each expose
a BullMQ queue; the Admin trigger and the scheduled tick enqueue the same job path. Ingestion uses
the connector id as the BullMQ job id, making a repeated trigger a no-op while that connector is
queued or running ([backend/src/ingestion/queue.ts:41](../../backend/src/ingestion/queue.ts:41)).
Clustering and graph resolution use one constant run id for the same property
([backend/src/clustering/queue.ts:23](../../backend/src/clustering/queue.ts:23),
[backend/src/graph/queue.ts:16](../../backend/src/graph/queue.ts:16)).

The native worker owns all three schedules in one process (`:00/:15/:30/:45` ingestion, `:05`
clustering and `:20` graph resolution), with one worker per queue and concurrency 1
([backend/src/worker.ts:41](../../backend/src/worker.ts:41)). Redis transports the work; Postgres
holds the durable [IngestionRun](../../backend/src/entities/IngestionRun.ts:11),
[ClusteringRun](../../backend/src/entities/ClusteringRun.ts:14) and
[EntityResolutionRun](../../backend/src/entities/EntityResolutionRun.ts:10) rows that the Admin
console reads from its database queries ([dashboard route](../../backend/src/routes/dashboard.ts:149))
even when the worker is stopped. This is why a queue is justified: request latency,
provider pacing and retries belong to the worker, while the API can answer `202 {status:"accepted"}`
and remain responsive. It is also why the worker is not a separate Compose service: ADR-0015 keeps
the application process native for the course demo ([docs/adr/0015-local-demo-compose-deps-seed.md](../adr/0015-local-demo-compose-deps-seed.md)).

`runConnector` is the single ingestion seam and applies canonical URL identity before insert or
enrichment ([backend/src/ingestion/runConnector.ts:33](../../backend/src/ingestion/runConnector.ts:33)).
[`runClustering`](../../backend/src/clustering/runClustering.ts:366),
[`runGeneration`](../../backend/src/generation/runGeneration.ts:354) and
[`runEntityResolution`](../../backend/src/graph/runEntityResolution.ts:387) are the corresponding
write seams.

## Data model and consistency

The model is evidence-centred rather than user-centred. A Publisher produces Articles; clustering
adds a StoryAssignment whose status controls visibility. A GenerationRun points at an immutable
EvidenceSet, and each AnalysisClaim points to evidence IDs in that set. The final reader path
checks the frozen rows again before displaying claims ([backend/src/generation/runGeneration.ts:421](../../backend/src/generation/runGeneration.ts:421)).

Evidence selection is deterministic: accepted membership, non-empty analysis text, vector rank,
publisher bounds, near-duplicate collapse and stable tie-breakers. The exact snapshots and their
provenance are hashed with SHA-256 ([backend/src/generation/evidence.ts:50](../../backend/src/generation/evidence.ts:50)).
Reuse therefore requires the same Story, Lens, prompt version, provider, model and evidence hash
([backend/src/generation/runGeneration.ts:116](../../backend/src/generation/runGeneration.ts:116)); a
changed Article or provider cannot silently inherit an old answer.

Postgres is the graph store. ADR-0019 rejects a graph database because recursive CTEs, foreign keys
and transactional writes already provide the bounded read picture and Article-cited edges this
course scope needs ([docs/adr/0019-knowledge-graph-gkg-bounded.md](../adr/0019-knowledge-graph-gkg-bounded.md)).
The graph write pass is `runEntityResolution`; the read pass is `loadGraphView`, which uses one
`REPEATABLE READ` snapshot for its bounded statements ([backend/src/graph/loadGraphView.ts:328](../../backend/src/graph/loadGraphView.ts:328)).
Clustering assignment and merge paths lock the rows they score with `SELECT ... FOR UPDATE`
([backend/src/clustering/runClustering.ts:178](../../backend/src/clustering/runClustering.ts:178)).

## Caching and external boundaries

External systems sit behind ports and adapters: `SynthesisProvider`, `EmbeddingProvider` and
`MarketProvider`, each with an environment-selected OpenAI-compatible/Tiingo implementation and a
deterministic Mock. The selectors are [synthesis](../../backend/src/synthesis/index.ts:36),
[embeddings](../../backend/src/embeddings/index.ts:1) and [market](../../backend/src/market/index.ts:28);
provider/model identity is recorded in generated rows ([generation seam](../../backend/src/generation/runGeneration.ts:354)).
See also [ADR-0025](../adr/0025-provider-architecture-openai-compatible-hosts.md).

There are three distinct cache mechanisms:

1. Generation reuse is a Postgres lookup on the EvidenceSet content hash, prompt version, Lens,
   provider and model. Identical concurrent requests share one in-memory promise in the single
   native API process ([backend/src/generation/runGeneration.ts:203](../../backend/src/generation/runGeneration.ts:203)).
2. Market quotes are read through a Redis-backed `quoteResult()` seam with a TTL; a cached null
   means "this Ticker has no quote", while provider failure is not cached
   ([backend/src/market/index.ts:44](../../backend/src/market/index.ts:44)). Market Read prose has
   its own content-hash Redis key ([backend/src/market/marketRead.ts:99](../../backend/src/market/marketRead.ts:99)).
3. BullMQ already uses Redis as its queue transport. Phase 3.6 identifies the measured
   `comparableStories()` dashboard path as the next Redis cache candidate; that is a performance
   extension, not a second source of truth.

The same boundary carries rate limits for auth and expensive endpoints through Redis when configured
([backend/src/middleware/rateLimit.ts:7](../../backend/src/middleware/rateLimit.ts:7)). Structured
request logging is emitted with request IDs at the Express boundary
([backend/src/app.ts:40](../../backend/src/app.ts:40)); queue and worker events use the same logger.

## Quality and trade-offs

Quality is measured at the seams and recorded in run rows: [connector discovery/insert/duplicate
counters](../../backend/src/entities/IngestionRun.ts:41), [clustering assignment/review/unclustered
counters](../../backend/src/entities/ClusteringRun.ts:38), and [entity promotion/merge/proposal/edge
counters](../../backend/src/entities/EntityResolutionRun.ts:34). Citation validation sits below the prompt, so a model cannot tune its way around the
claim invariant ([validation path](../../backend/src/generation/runGeneration.ts:421)). The deliberate ceilings are documented next to the code: one worker process at
concurrency 1, in-memory coalescing, and an O(n^2) near-duplicate comparison over one Story's small
candidate set. Each names its upgrade path if measured scale changes.

The architecture is therefore intentionally one application with clear seams: Postgres carries
durable relational and graph state, Redis carries queue/cache coordination, hosted providers carry
embedding and synthesis work, and every reader surface is a read of persisted evidence rather than
an invitation to recompute it.
