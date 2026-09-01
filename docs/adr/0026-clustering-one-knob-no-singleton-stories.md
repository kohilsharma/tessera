# 26. Clustering: one similarity knob, no singleton Stories, curated corpus closed

Date: 2026-08-31
Status: Accepted
Depends on: ADR-0009 (batch clustering + Admin review), ADR-0024 (text-mode ladder),
ADR-0025 (embedding providers)
Refines/corrects: v3 §9.4 (`StoryArticle`), §14.3 (composite score), §14.4 (three outcomes)

## Context

ADR-0009 decided *that* clustering is a batch job with Admin review, and deliberately
decoupled demo quality from it by hand-authoring fixture Stories. It did not decide the
job's shape. v3 §14.3 specifies a six-component weighted score and §9.4 a `StoryArticle`
join carrying six component scores, an assignment method, an assignment status and a
clustering version.

Three facts about this build make most of that shape unbuildable or unusable now:

1. **There is no eval harness until Phase 5** (ADR-0011), so every weight is tuned by eye.
   Three weights plus a threshold is four numbers no human can tell apart by eyeballing
   news clusters.
2. **The majority of ingested rows are `metadata_only`** (ADR-0024) — GKG and DOC carry no
   body and no snippet. Title-only similarity is the weakest signal available, on exactly
   the rows the Retention Window exists to delete.
3. **The curated corpus is synthetic** (ADR-0007): eight invented publishers on `.example`
   domains. It has embeddings, so without an explicit rule it is an assignment candidate
   like any other Story.

## Decision

- **Eligibility**: only Articles at `feed_excerpt` or above are clustered. `metadata_only`
  rows are never considered — they keep aging out under the Retention Window, and
  `metadata_only` was already never sufficient evidence for a claim. `manual_fixture` is
  excluded too, which closes the **Curated Corpus**: fixture Articles are not clustered and
  fixture Stories are not assignment candidates, in both directions.
- **One knob.** Assignment scores cosine similarity against the Story centroid. Time is a
  hard **gate**, not a weighted term: a Story whose `lastSeenAt` falls outside the window is
  not a candidate at any similarity. Two tunables total (threshold, window) — the two numbers
  that change *which Articles land together*. `CLUSTERING_EMBED_BATCH_SIZE` also reads from
  the environment and is deliberately not a third: it bounds one request to the embedding
  provider (ADR-0025 counts requests, so a run batches), a run drains every eligible Article
  whatever it is set to, and no value changes a single membership decision. A knob that
  cannot change an outcome is not calibration.
- **No singleton Stories.** A new Story is seeded only when at least two mutually-matching
  Articles from at least two distinct Publishers are available. An Article that matches
  nothing stays Unclustered and is reconsidered every run.
- **Membership lives on `articles`**: `storyAssignmentStatus` (auto-accepted | pending
  review) and `storyAssignmentScore`. No `StoryArticle` join — an Article belongs to at most
  one Story and no assignment history is kept, so the join table would buy a second table, a
  hand-enforced uniqueness constraint and a join on every read path to hold what two columns
  hold. No `clusteringVersion` column: reclustering is not built, so nothing would write a
  second value.
- **Story carries a centroid** (`stories.embedding vector(1024)`), recomputed from members
  each run rather than maintained incrementally — a running mean drifts as members are
  accepted, rejected and merged.
- **No `status` column.** Dormancy is derived from `lastSeenAt` by the gate above. Merge
  moves the Articles, recomputes the survivor's centroid and deletes the emptied row.
- **Story naming is one LLM call per newly created Story**, returning a title and a category
  from the eight-value enum, falling back to the medoid Article's title when the call fails
  or answers off-enum.
- **Embedding is the clustering job's own input step**: it embeds eligible Articles with a
  null vector in batches (ADR-0025's request-counted limits). Enrichment sets
  `embedding = NULL` when it writes new text, so a null vector means one thing — needs
  embedding.
- **Operationally** a second repeatable BullMQ job, hourly, alongside ingestion's, with an
  Admin trigger and a `clustering_runs` history table. Thresholds are typed constants in
  `clustering/config.ts`, env-overridable; no `SystemConfig` table.
- **Admin review** ships as accept/reject of pending assignments and merge of two Stories.
  Split, move, mark-duplicate, reactivate and versioned reclustering are deferred.

## Consequences

- ADR-0010's "minimum 2 distinct publishers for comparative synthesis" is satisfied **by
  construction** for every clustered Story. The check stays, because a fixture Story is
  still reachable.
- Story naming is the one non-deterministic step in an otherwise reproducible pipeline:
  re-running clustering reproduces membership, not titles.
- Stories accumulate with nothing to age them out — the Retention Window covers
  `metadata_only` GDELT rows only. Watch it; dormancy is already a query if it bites.
- Adding score components later changes no schema: `storyAssignmentScore` is one number
  whatever produces it.
