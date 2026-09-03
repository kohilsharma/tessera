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
  not change what a past generation was based on. It records its own weakest **Analysis Text
  Mode**, which is what decides whether an omission may be claimed at all. (ADR-0027)

- **AnalysisClaim** — A single evidence-bearing statement produced by generation
  (consensus / source-specific / contradiction / caveat / lens-specific). A claim with no
  valid supporting evidence ID is invalid and must be rejected. Rejecting one claim does not
  reject its generation — the invariant is about what is *displayed* — but a run that cannot
  produce two surviving claims including one consensus claim fails as a whole, and the reader
  is shown a stated unavailable state rather than whatever survived. (ADR-0027)

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
  prompt only — never the citation-validation layer, which lives below it. Immutable and never
  deleted: tuning is *creating* a version, and activating one is the only change — which is what
  makes a past GenerationRun's prompt version resolve to the parameters that wrote it. Parameters
  that could not produce a publishable answer (a claim count under the floor, a surfaced set
  without `consensus`) are refused at the boundary rather than accepted and failed below the
  prompt. (ADR-0021)

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

- **Entity** — A canonical person, organization or location, resolved from GKG surface-name
  strings. Not every name becomes one: a name is *promoted* only once it clears the **Entity
  Promotion Floor**, and below it stays an unresolved **GKG Annotation** that expires with its
  Article. Resolution is normalization plus fuzzy candidate matching — Postgres trigram
  similarity over the normalized names — against a confidence threshold, with the band beneath
  it queued for Admin review as a *Merge proposal*; the same shape as a *Story
  Assignment*'s review band, for the same reason. Locations reuse GKG FeatureIDs (already
  disambiguated). Themes are **not** Entities (see *Theme*). (ADR-0018, ADR-0019, ADR-0028)

- **Entity alias** — A normalized surface name that resolves to another one, so the pass folds
  the two wherever it reads names. What makes a merge outlive the run that made it: a pass
  re-promotes every name above the *Entity Promotion Floor* hourly, so a merge remembered only
  as a deleted row would be undone within the hour. Written by both an automatic merge and an
  accepted *Merge proposal*, and always terminal — folding B into C repoints A's alias at C
  rather than leaving a chain to walk. (ADR-0019, ADR-0028)

- **Entity Promotion Floor** — The number of distinct Articles a surface name must appear in
  before it becomes an Entity. What makes "bounded" a property of the data rather than a
  cleanup job: one GKG window yields ~2,000 distinct person names but ~130 seen in five or more
  Articles. A name that falls back below the floor is not an Entity any more — Tessera keeps a
  *bounded working set*, not a permanent registry of everyone ever named. (ADR-0019, ADR-0028)

- **EntityEdge** — A **co-occurrence** link between two Entities ("co-mentioned in the same
  Article"), each carrying its `source_article_id`(s). NOT a typed relation (acquired/sued/
  partnered) — typed edges are deferred post-course. An uncited edge is a bug, and an edge
  therefore lives exactly as long as the Article it cites: the firehose-derived part of the
  graph rolls over with the *Retention Window*, while edges cited to Articles the corpus kept
  are permanent. Bounded per Entity, strongest co-occurrences first — bounded nodes do not
  imply a bounded picture. (ADR-0019, ADR-0028)

- **Entity Resolution Run** — One invocation of the entity-resolution pass, and the record of
  what it did: how many *GKG Annotations* and Articles it read, how many candidate names it
  considered, how many it *promoted*, how many fell below the *Entity Promotion Floor*, how many
  Entities it demoted out of the working set, how many pairs it merged itself, how many it left
  as *Merge proposals*, and how many *EntityEdges* the graph now carries.
  Its ledger is `promoted + belowFloor = considered`; the two merge counters sit outside that sum
  because they count *pairs*, and both names of a merged pair were promoted by the same pass
  before it folded them. The counterpart of a *Clustering Run*, and
  read from Postgres for the same reason — the Admin view must render with the worker down. A
  pass rebuilds the whole graph in one transaction, so a failed run changed nothing and says so.
  (ADR-0019, ADR-0028)

- **Merge proposal** — Two surface names close enough to be one Entity but not close enough to
  fold unseen, held for an Admin and changing nothing until decided. Generated in the band
  between the review floor and the automatic bar, both trigram similarities read from env: v3
  §18.5 governs where they sit, since a wrong merge is more harmful than an unresolved
  duplicate, so the bar clears every wrong merge measured on real names and the doubt goes in
  the band. Accepting it merges the pair and writes an *Entity alias*; refusing it records a
  *Refused merge*. Same-kind by construction — folding `Ford` the person into `Ford` the company
  is the wrong merge the bar exists to prevent. (ADR-0019, ADR-0028)

- **Refused merge** — Two surface names an Admin declined to resolve into one Entity,
  remembered so later runs never re-propose the pair. Keyed on the *names*, not on Entity ids,
  because an Entity is a working-set row that may roll away and come back while the judgement
  about the two names stays true — the pair stays unproposed across both names leaving the
  working set and being promoted again. The entity-resolution counterpart of a *Rejected
  pairing*, which keys on ids because Stories are durable. (ADR-0019, ADR-0028)

- **Theme** — One of GDELT's controlled-vocabulary subject codes on an Article. The cleanest
  annotation Tessera receives and deliberately never a graph node: at ~48 per Article, theme
  co-occurrence is close to a complete graph and says nothing. A Theme is a **facet** — what
  the graph and the timeline are filtered *by*. (ADR-0028)

- **Timeline** — A **computed** read view of Articles ordered over time, with the analytical
  events that happened to them — an *EvidenceSet* freeze, a completed *GenerationRun* — on the
  same axis. Reached two ways: as a register on a Story, and as its own route over any search.
  Over a search it groups the matching Articles into one lane per Story, so parallel events
  read as parallel. The one overlay is **volume**, reporting per period. Tone is **not** an
  axis, ADR-0020's "for free" notwithstanding: `articles.tone` is GDELT's, and it reaches a
  clustered Story only by cross-connector *Enrichment*, which measured zero on 2026-09-01 — so
  the register states that in a line rather than drawing an empty axis. Showing evolution only
  — NOT change-detection/alerting. _Avoid_: "generated timeline". *Generation* in Tessera means
  the cited-synthesis pipeline; a timeline is assembled from rows that already exist, costs
  nothing per view, and no model writes any part of it. (ADR-0020, ADR-0028)

## Coverage, markets and study (Phase 3.6)

- **Publisher Leaning** — a publisher's political placement on a left / centre / right axis,
  taken from a **published third-party rating** (AllSides, CC BY-NC 4.0) and always displayed with
  its source named. It is a *cited claim about a publisher*, never Tessera's own inference — which
  is what lets the product show it at all. A publisher with no rating is stated as unrated, never
  guessed.

- **Coverage Spectrum** — how one Story's accepted reporting distributes across Leanings. Counted
  over Articles, not Publishers, so five reports from one outlet do not read as five viewpoints.

- **Blindspot** — a Coverage Spectrum with effectively nothing from one side. Named as a finding on
  screen rather than left for the reader to infer from a bar's shape.

- **Ticker** — the market symbol a canonical Entity resolves to, set only for organizations. It is
  what joins reporting to markets: a Story shows a market panel when its resolved organizations
  carry Tickers, and shows nothing when they do not.

- **Market Read** — a generated paragraph describing what the reporting and the computed indicators
  each show. It states no causal link between them and never advises: the same
  `prohibited_investor_language` validation that governs analysis governs this. Contrast: an
  *indicator* is arithmetic we compute; a Read is a model call about it.

- **Watchlist** — an Investor-owned set of Tickers and sectors they follow. The one piece of
  per-user state on the Investor side, and what makes their dashboard their own rather than a
  global rollup.

- **Flashcard** *(revised, Phase 3.6)* — a Student-owned Q/A card that owns **its own** question,
  answer and citations into a frozen EvidenceSet. Born either from a search (the matching Articles
  freeze into the set) or from a completed analysis. Scheduled by spaced repetition (SM-2).
  Supersedes the earlier definition in which a card was an AnalysisClaim with a question in front
  of it.

- **Role Theme** — the visual identity a signed-in role wears: Student → Studio, Investor →
  Terminal, Admin → Newsroom, signed-out → Newsroom. A property of *who you are*, not a
  preference, and not user-overridable. Light/dark is the separate axis the reader does control.
  `DESIGN.md` is the contract.

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
  Articles that arrived without full text and never yet attempted (a mark only a migration
  repairing a broken pass has ever cleared — #70), capped per run and paced
  per publisher domain: a firehose row's page is deliberately out of reach, because following
  63k unknown domains a day would make Tessera a general-purpose crawler. An Article whose feed
  already supplied a body is left alone, as is one whose Publisher has cleared its excerpt for
  serving but not the rung extraction would produce — since ADR-0032 that is `syndicated_excerpt`
  alone, the one class where raising the Article would take text *out* of the API instead of
  putting it in. Failure — a paywall, a consent wall, a bot block, a body no longer than the
  excerpt it would replace — is an expected outcome that leaves the Article on the rung it already
  held and is counted as failed on the run. (ADR-0018, ADR-0024, ADR-0032, #47)
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
  `licensed`. That is all it governs (ADR-0032): `licensed` clears every rung of the ladder
  including `api_content`, `syndicated_excerpt` clears `feed_excerpt` alone, and the other two
  clear no text at all. Storing a body for internal analysis — enrichment, embeddings, evidence
  selection — is cleared globally, so no sighting is ever discarded on rights grounds and the
  IngestionRun's rejected-on-rights count reads 0 until a re-tightening repopulates it.
  Reclassifying a publisher governs what is served and what arrives next; it does not purge text
  already stored. Assigned by hand; publishers auto-created by a connector default to `licensed`,
  because this is a non-commercial course build and a fail-closed default meant every publisher
  outside the seed withheld its text from the reader who asked "says who?". Narrowing one is a
  reclassification, not a code change. (ADR-0032, ADR-0018, ADR-0024)
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
- **Story-scoped graph** — rejected on measurement, not taste: GKG Annotations land on
  `metadata_only` firehose rows, which never cluster, so a graph scoped to the Story in view is
  an empty graph. The graph reads the retained firehose instead, and ADR-0019's "noisy
  duplicate nodes" risk is answered by the *Entity Promotion Floor* and the per-Entity edge
  bound. (ADR-0019, ADR-0028)
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

All decisions are recorded in `docs/adr/0001`–`0029`. The 2026-09-01 additions open Phase 3.5: ADR-0028 corrects ADR-0019's Story-scoping clause after measuring zero cross-connector overlap between the GKG firehose and the RSS feeds — the graph is firehose-derived, rolling and entity-centric, its Entities promoted on a frequency floor — and ADR-0029 opens the Curated Corpus to entity resolution while ADR-0026 keeps it closed to clustering. The 2026-08-31 additions open Phase 3:
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
