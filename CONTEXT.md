# Tessera — Domain Glossary

The ubiquitous language for this project. Glossary only — no implementation details.
Terms are canonical: use these words in code, docs, and conversation.

## Core artifacts

- **Story** — A persistent cluster of related Articles about one evolving real-world
  event. Shared global knowledge; has no single user owner. Not a user's saved item.
  Clustering forms one only from Articles that carry text (`feed_excerpt` or above) and only
  when at least two of them, from two distinct Publishers, agree — a Story of one is not a
  Story. The **Curated Corpus** is closed to clustering in both directions. (ADR-0026)
  A new Story is **named** by one model call over its members' headlines, once, at creation:
  the only non-deterministic step in clustering, so a re-run reproduces membership but not
  titles. An existing Story is never renamed, and an unusable answer leaves the Story named
  after its medoid Article. (ADR-0026)

- **Article** — One piece of reporting discovered from a connector. Carries the text
  actually available for analysis (see *Analysis Text Mode*), not necessarily full body.
  An **Unclustered Article** is an Article with no Story yet — the normal state of everything
  ingestion produces until clustering assigns it, and the permanent state of what clustering
  will not consider: `metadata_only` rows, and reporting that has not yet found a second,
  independently published match (ADR-0026). A *state*, not a second entity: every
  public read path joins through Story, so unclustered Articles are invisible to browse and
  search by construction. (ADR-0022)

- **IntelligenceBrief** — The user-*owned* analytical artifact built on top of a Story.
  This is the course's required "core business entity" (title, note, category, timestamp,
  capacity, cover image, owner). A Brief freezes a specific generation. Contrast: a Story
  is global and unowned; a Brief is personal and owned.

- **EvidenceSet** — The frozen, immutable list of exact Article snapshots (with stable
  evidence IDs like `A1`) used for one generation. "Frozen" means later Article edits do
  not change what a past generation was based on.

- **AnalysisClaim** — A single evidence-bearing statement produced by generation
  (consensus / source-specific / contradiction / caveat / lens-specific). A claim with no
  valid supporting evidence ID is invalid and must be rejected.

- **Citation / ClaimEvidence** — The link from a Claim to the specific Article(s) that
  support or contradict it. The invariant: *no displayed factual claim without a valid
  citation into its generation's EvidenceSet*.

- **GenerationRun** — One attempt to produce analysis from an EvidenceSet with a specific
  prompt+model. Records status, raw output, validation result, cost, and the *PromptTemplate
  version* used. Reproducible from its frozen EvidenceSet. Belongs to the **Story**, one
  current run per **Lens**, so synthesis is shared rather than paid for per reader; an
  IntelligenceBrief owns a generation by referencing the run it froze. (ADR-0027)

- **Lens** — The single role-specific claim type carried by one generation:
  `student_context` or `investor_implication`. Exactly one per GenerationRun, chosen by the
  requesting user's role rather than picked from a menu — which is what makes Student and
  Investor different *output*, not a flag. _Avoid_: "mode", "view" — both already mean other
  things here. (ADR-0010, ADR-0021, ADR-0027)

- **PromptTemplate** — A versioned prompt + generation-params record that Admin tunes to shape
  responses for everyone (tone, verbosity, lens emphasis, which claim types surface). Tunes the
  prompt only — never the citation-validation layer, which lives below it. (ADR-0021)

- **Flashcard** — A Student-owned Q/A study card generated from a Story/Brief. Its answer must
  cite evidence from a frozen EvidenceSet like any other claim; scheduled via spaced repetition
  (SM-2). (ADR-0021)

## Clustering

- **Story Assignment** — An Article's membership in a Story, carrying the state that decides
  whether anyone can see it: *auto-accepted* (above the similarity threshold) or *pending
  review* (in the band beneath it, awaiting an Admin). A pending assignment is invisible to
  browse, to search, and to evidence selection — so a borderline guess can never reach a
  reader or ground a claim. It still carries the Story's id, which is what lets a reviewer see
  what is being proposed, so "in a Story" is a question about the *state*, never about the
  presence of a `storyId`. (ADR-0009, ADR-0026)

- **Rejected pairing** — An (Article, Story) pair an Admin refused from the review queue. The
  Article returns to *Unclustered*, and the refusal is remembered so later runs never propose
  that pair again — every *other* live Story is still offered, because rejecting one proposal
  says the event is wrong, not that the reporting is unusable. _Avoid_: "blacklist", which
  suggests the Article itself is barred. (ADR-0026)

- **Story merge** — An Admin folding one Story into another when a deliberately tight
  threshold split one event in two. Every Article moves to the survivor with its decision
  intact — a pending assignment stays pending, now proposed for the survivor, and is rescored
  against the survivor's recomputed centroid (left *unscored* where there is nothing to
  compare) so the review queue never states a score measured against a Story that is gone.
  The survivor's centroid and its first/last-seen span are recomputed from the merged
  membership, and the emptied Story row is *deleted*, not tombstoned. Refused in either
  direction for a Story in the *Curated Corpus*, and refused for a Story merged into itself.
  Split, move and mark-duplicate are deferred. _Avoid_: "deduplicate", which is what ingestion
  does to Articles by canonical URL. (ADR-0026)

- **Clustering Run** — One invocation of the clustering job, and the record of what it did:
  how many Articles it embedded, assigned, held for review and left unclustered, and how many
  Stories it created. The counterpart of an *IngestionRun*, and read from Postgres
  for the same reason — the Admin view must render with the worker down. A *Story merge* is
  not part of a run: it is an Admin command, recorded only in its effect. (ADR-0026)

- **Curated Corpus** — The hand-authored fixture Stories and Articles: synthetic reporting
  from invented Publishers, guaranteed clean, multi-source and reproducible, and the
  rehearsed demo path (ADR-0007). Closed to clustering in both directions — its Articles are
  never clustered and its Stories never accept a live Article — so it cannot drift, and a
  demo Story can never turn out to be half real and half invented. _Avoid_: "seed data",
  which also means the demo users and the connector list. (ADR-0026)

## Knowledge graph & timeline (Phase 3.5 — bounded, GKG-backed)

- **Entity** — A canonical person / organization / location resolved from GKG surface-name
  strings via an alias map + confidence threshold (borderline merges go to Admin review).
  Locations reuse GKG FeatureIDs (already disambiguated). (ADR-0018, ADR-0019)
- **EntityEdge** — A **co-occurrence** link between two Entities ("co-mentioned in the same
  article/Story"), each carrying its `source_article_id`(s). NOT a typed relation (acquired/
  sued/partnered) — typed edges are deferred post-course. An uncited edge is a bug. (ADR-0019)
- **Timeline** — A read view of a Story's Articles/EvidenceSets ordered over time (with GKG
  tone/volume overlays). Showing evolution only — NOT change-detection/alerting. (ADR-0020)

## Roles

- **Student** — Consumer role focused on learning/context. Distinct permissions & dashboard
  (study collections, guided reading, citation export, **flashcard generation**).
- **Investor** — Consumer role focused on business implications. *Distinct* permissions &
  dashboard (watchlist/sectors, **cross-source consensus/contradiction** on a company/sector,
  implication briefs) — deliberately NOT "Student + one lens". (ADR-0021)
- **Admin** — Operator role: manages connectors, reviews clustering, reviews **entity-resolution
  merges**, **tunes PromptTemplates** for everyone, inspects generations. Never implicitly owns
  a user's Brief.

## Acquisition

- **Publisher** — Who originates reporting. Owns rights fields (see *Terms Class*).
- **IngestionConnector** — *How* Tessera discovers/receives data (RSS, GDELT_DOC, etc).
  A connector is not a publisher; a GDELT connector spans many publishers. For a source that
  answers a *question* rather than streaming — the DOC API — the question is part of the
  connector: it lives in the endpoint's query string. That is a data change rather than a code
  change, but it is not yet an operator-facing one: the seed owns every seeded connector's
  endpoint and converges a stale one, so changing the standing query means changing the seed
  constant. Only `enabled` is the Admin's to set through the API. (#46)

- **Extraction** — Reading a publisher's own page for the body its feed only teased, raising
  that Article from `feed_excerpt` to `api_content`. It is a connector too (`readability`),
  because what an operator needs around it — enable/disable, an on-demand Run, one
  IngestionRun per invocation — is what a connector already has; but it discovers nothing,
  so its "endpoint" names the pass rather than an address. Restricted to RSS-discovered
  Articles that arrived without full text and never yet attempted, capped per run and paced
  per publisher domain: a firehose row's page is deliberately out of reach, because following
  63k unknown domains a day would make Tessera a general-purpose crawler. An Article whose feed
  already supplied a body is left alone, as is one whose Publisher has cleared its excerpt for
  serving — no Terms Class clears an extracted body, so raising it would take text out of the
  API. Failure — a paywall, a consent wall, a bot block, a body no longer than the excerpt it
  would replace — is an expected outcome that leaves the Article on the rung it already held
  and is counted as failed on the run. (ADR-0018, ADR-0024, #47)
- **IngestionRun** — One invocation of one connector, and the only record of what that
  invocation did: how much it discovered, inserted, enriched, rejected as duplicate, rejected
  on rights, and failed. Persisted in Postgres, never read back from the queue — the Admin
  ingestion view must render with the worker down. (ADR-0024)
- **Ingestion Worker** — The process that executes IngestionRuns. (ADR-0005, ADR-0015,
  ADR-0018)
- **Analysis Text Mode** — What text is actually available for an Article, as an **ordered
  ladder**, weakest first: `metadata_only` (title and metadata, no text at all) <
  `feed_excerpt` < `api_content` < `licensed_full_text`. `manual_fixture` sits outside the
  ladder — it is our own synthetic seed text. An Article's mode only ever moves *up*.
  Product wording must match the weakest mode in an EvidenceSet (never claim "publisher
  omitted X" from an excerpt), and `metadata_only` is never sufficient evidence for a
  claim on its own. (ADR-0024)
- **Terms Class** — The per-Publisher rights vocabulary governing whether Tessera may
  *serve* that publisher's text: `open_metadata`, `syndicated_excerpt`, `internal_only`,
  `licensed`. `api_content` — a body Tessera extracted from the page itself — is never served
  whatever the class, because no publisher's terms grant text they never handed us (ADR-0018).
  Storing bodies for internal analysis is governed globally instead (ADR-0018), with one
  exception: `open_metadata` has cleared its metadata and nothing else, so text-bearing
  reporting from such a publisher is not stored and is counted on the IngestionRun as rejected
  on rights grounds. Reclassifying a publisher governs what is served and what arrives next; it
  does not purge text already stored. Assigned by hand; publishers auto-created by a connector
  default to `internal_only` — the gate fails closed. (ADR-0018, ADR-0024)
- **Enrichment** — A second connector finding an Article Tessera already holds (same
  canonical URL) and contributing what it carries: GKG Annotations, or text further up the
  ladder. A same-canonical-URL sighting that contributes *nothing* — re-running an unchanged
  feed — is not enrichment and is counted as a Duplicate instead; an enrichment count that
  ticks for no-ops tells an operator nothing. _Avoid_: calling an enrichment a duplicate. Two
  instruments seeing one document is not duplication, and discarding the newcomer loses data
  whichever one arrives second.
- **Duplicate** — Reporting Tessera declines to store: either the same reporting at a
  *different* canonical URL, caught on normalized title + publisher + date, or a same-URL
  sighting with nothing to contribute (above). Rejected on arrival and counted on the
  IngestionRun. Syndicated wire copy running across many publishers is deliberately *not*
  handled here: the rows are real, and five outlets running one report is itself signal.
  It is collapsed where it would mislead — inside an **EvidenceSet**, which is a claim about
  *independent* corroboration, so a near-identical copy of an already-selected Article is
  skipped and `distinctPublisherCount` counts newsrooms rather than mastheads.
  (ADR-0024, ADR-0027)
- **GKG Annotation** — One surface-name occurrence of a person, organization, location or
  theme in one Article, exactly as GDELT's GKG reported it, before any resolution. The
  pre-resolution raw material an **Entity** is later resolved *from*. _Avoid_: "GKG mention" —
  GDELT ships a `mentions` file meaning something else entirely (an event referenced in an
  article). (ADR-0018, ADR-0019)
- **Window Cursor** — Where a connector's source got to, in that source's own terms: for GKG
  the 14-digit stamp of the last 15-minute window a run *finished*, for RSS the feed's
  `lastBuildDate`, and for the DOC API **nothing at all** — its result set is re-ranked on
  every request and truncated at GDELT's 250-record cap, so no position in it is resumable.
  Read back off the connector's own succeeded IngestionRuns, so it lives
  wherever the runs do. The Ingestion Worker is not a 24/7 service, so a **gap** in the
  firehose is the normal state rather than a fault: on its next run a GKG connector heals the
  windows between its cursor and the one GDELT is publishing now, naming their files
  arithmetically off the 15-minute grid (GDELT's `masterfilelist.txt` is never requested — it
  is 127 MB to learn something modulo already knows). A gap wider than the two-hour cap is
  **skipped rather than backfilled**, and the skip is stated on the run. _Avoid_: treating a
  gap as an error state; the cursor exists because gaps are expected. (#45)
- **Record Cap** — GDELT's DOC API returns at most 250 records per query and offers no paging
  past that. A run therefore always asks for the maximum and states on the IngestionRun when it
  received exactly that many, because a truncated result set silently reported as a complete one
  is a coverage claim Tessera cannot support. _Avoid_: reading `discovered` as "everything that
  matched". (#46, ADR-0018)
- **Retention Window** — The seven days beyond which a GDELT-derived Article is removed, measured
  from when the row was *stored*, so unbounded metadata producers have a ceiling on disk. Narrow
  by design: only rows a GKG **or DOC** connector discovered that are still `metadata_only`.
  RSS-discovered reporting, anything enriched with text, an Article a Story or a Brief has taken
  hold of, and
  the curated fixture corpus all outlive it. GKG Annotations go with the Article they were
  staged against. _Avoid_: expiring on `publishedAt` — GDELT reports documents whose own
  timestamp is old, and that would insert, prune, and re-insert them window after window. (#45,
  #46)

## Deferred (startup-only, behind interfaces — NOT in graded build)

- **Typed RelationAssertion** — Typed edges (acquired/sued/partnered) beyond co-occurrence.
  GKG doesn't provide them; needs a separate LLM extraction pipeline. Highest risk. (ADR-0019)
- **Neo4j / Apache AGE** — The graph ships in **plain Postgres** tables + recursive CTEs; a
  dedicated graph store is an optional later projection, not built. (ADR-0019)
- **Broad cross-Story firehose graph** — rejected for the "noisy duplicate nodes" demo risk;
  the graph is bounded/curated (~50–200 nodes, scoped to the Story in view). (ADR-0019)
- **TrackedTopic / Notification / change-detection** — Monitoring mini-product (alert on what
  changed), cut from graded build. Distinct from the Timeline *view*, which ships. (ADR-0011, ADR-0020)
- **Refresh-token rotation** — Deferred security hardening; plain JWT ships. (ADR-0013)
- **Local embedding serving (bge-m3 via TEI)** — Optional local provider behind the
  `EmbeddingProvider` interface; a **hosted embedding API** is the default. The vector space
  stays `vector(1024)` either way. (ADR-0017, ADR-0023)

## Kept but sequenced last (degradable)

- **Evaluation harness** — Clustering precision/recall + generation pass-rate over fixtures.
  Built AFTER the flagship; collapses to a one-shot "eval sliver" if time is short. (ADR-0011)

## Decision index

All decisions are recorded in `docs/adr/0001`–`0027`. The 2026-08-31 additions open Phase 3:
ADR-0025 puts embeddings and synthesis behind one OpenAI-compatible transport with
NVIDIA-hosted defaults (superseding ADR-0023's hosted-default clause, not its `vector(1024)`
decision), ADR-0026 fixes clustering as a single similarity knob with no singleton Stories and
a closed Curated Corpus, and ADR-0027 settles what ADR-0010 left open — deterministic evidence
selection, partial claim acceptance with a floor, and repair in place of a model-escalation
ladder. ADR-0024 (2026-08-30) makes Analysis
Text Mode an ordered ladder, adds the `metadata_only` rung for GKG-discovered Articles, and
separates enrichment from duplication at the connector seam. ADR-0023 (2026-08-21) moves embedding
serving to a hosted API default after a system-RAM measurement on the demo machine; the
`vector(1024)` space and provider interface are unchanged. The 2026-07-26 additions
(ADR-0017–0022) un-defer the knowledge graph + timeline (GKG-backed, bounded), upgrade
embeddings (@ vector(1024)), pin the ingestion architecture (GDELT GKG firehose), add
role features (flashcards / Admin tuning / investor consensus), and revise the build order.
They **supersede** parts of ADR-0002 (→0019), ADR-0008 (→0017), ADR-0011 (→0020), ADR-0016
(→0022). `AGENTS.md` binds agents to v3 + these ADRs. The old `ai-news-intelligence-spec.md`
is a superseded draft — do not build from it.
