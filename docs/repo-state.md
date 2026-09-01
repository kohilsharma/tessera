# Repo state — the long narrative

One entry per shipped ticket, in build order. `AGENTS.md` carries the compressed table;
this is the prose behind it, kept for the measurements and the reasoning that a table
cannot hold. Append here when a ticket ships; keep the table in `AGENTS.md` current.


**backend/** — Express + TypeORM. Auth (#17), role-guard middleware + dashboards (#18), a
seeded Publisher/Story/Article corpus with browse endpoints (#19), IntelligenceBrief CRUD with
cover images (#20, #21), hybrid search over the corpus (#22 — Postgres FTS + pgvector cosine,
fused by RRF), and Phase-1 demo hardening (#23 — finalized Compose, hosted EmbeddingProvider,
a seeded owned Brief) are live; `GET /api/v1/health` from the walking skeleton (#16) too.
Phase 2 has started: the **RSS connector tracer bullet** (#39) is in — `src/ingestion/`
(`runConnector` is the one new seam, over `canonicalUrl` + `rss`), `POST
/api/v1/ingestion/connectors/:id/run` and `PATCH .../:id` (Admin-only), an `ingestion_runs`
table, and 10 curated real RSS feeds in the seed. Ingested reporting lands as **Unclustered
Articles** (`articles.storyId` is nullable and ingestion leaves it null), so it is invisible
to browse and search by construction.
Each Publisher now carries a **Terms Class** (#40) and *that* decides whether the API serves
its text: fixture Publishers are `licensed` (the text is ours), anything a connector creates
defaults to `internal_only`, and an `open_metadata` publisher's text-bearing items are rejected
on rights grounds and counted on the run.
The **GKG connector** (#41) is in: a run resolves the current 15-minute window from GDELT's
`lastupdate.txt`, downloads and unzips it, and parses the 27 tab-separated fields
(`src/ingestion/gkg.ts`), dropping GCAM at parse time. Its rows land on the ladder's weakest
rung — `metadata_only`, with genuinely null `analysisText`, since GKG carries no body and no
snippet — and keep GDELT's average tone in `articles.tone` for the Phase-3.5 timeline. All three
of ADR-0018's surfaces are enabled in the seed.
The **worker** (#42) closes the loop: `src/worker.ts` is its own process (natively, not in
Compose — ADR-0015) draining a BullMQ `ingestion` queue, with a repeatable tick on the
quarter hour that enqueues one run per enabled connector. The Admin trigger enqueues onto
that same queue and answers `202 {status:"accepted"}`, so there is one execution path; the
job id is the connector's id, so a trigger landing mid-run adds no second run, and worker
concurrency is 1. `src/ingestion/queue.ts` is the enqueue side, `src/ingestion/jobs.ts` the
handler. Run history is still read from Postgres, never the queue, so the Admin console
renders with the worker stopped.
**The window cursor and retention** (#45) make gaps in the firehose ordinary: a GKG run reads
back the last window it *finished* off its own succeeded runs, names the windows missed since
then arithmetically off the 15-minute grid (`masterfilelist.txt` is never requested), and reads
them oldest-first before going live — capped at 8 missed windows, past which the gap is skipped
rather than backfilled and the skip is stated in the run's `errorSummary`. The same tick prunes:
GDELT-derived Articles (GKG or DOC) stored more than 7 days ago are deleted, taking their
Annotations with them, and only while they are still `metadata_only`, unclustered and uncited —
so RSS reporting, enriched text and the curated corpus never age out
(`src/ingestion/retention.ts`).
**GKG Annotation staging** (#43) is in: the parser also reads GDELT's four enhanced fields
(persons, organizations, themes, locations) into surface-name occurrences, and a run stages
them per Article in one `gkg_annotations` table (kind + surface name + character offset, plus
a nullable `locationDetail` JSONB carrying FeatureID, coordinates and country). Occurrences
are the row identity, so re-reading a window stages nothing twice and a sighting whose only
contribution is annotations counts as an Enrichment. Nothing reads them yet — Phase 3.5
resolves Entities from them and builds co-occurrence edges by self-joining.
**Cross-connector enrichment** (#44) is the behaviour ADR-0024 exists for: a second connector
sighting an Article's canonical URL attaches what it brings (excerpt text, tone, GKG Annotations,
GKG's source Publisher), raises the Analysis Text Mode only upward, makes no second Article, and
is counted as `enriched` — its own outcome beside inserted, duplicate, rejected-by-policy and
failed, which sum to `discovered` (asserted for every run the suite persists) and are all on the
Admin console. Both arrival orderings — GKG then RSS, RSS then GKG — are driven end to end
against the committed GKG window, with each connector's real pipeline enriching the other's row.
The **DOC connector** (#46) closes ADR-0018's third surface and is mostly a parser
(`src/ingestion/doc.ts`) over machinery that already existed — the same `runConnector`, the same
canonical-URL identity, the same dedup and enrichment. What is new: the query lives in the
connector's `endpoint` query string (a seed constant an Admin cannot yet PATCH — only `enabled`
is API-editable) while the connector forces `mode=artlist&format=json&maxrecords=250`; the API
gets a
browser-like User-Agent and a 5-second floor between requests, because it blocks a caller that
looks like a bot or asks too often (measured: a rapid request is answered 200 with GDELT's own
plain-text rate-limit notice);
a full 250-record response is stated as **truncated** on the run rather than reported as
complete; and artlist carries no body or snippet at all, so DOC rows land on the same
`metadata_only` rung as GKG's and are pruned by the same retention pass (now
`pruneExpiredGdeltArticles`, covering both GDELT kinds).
The DOC connector was later **restored** (#60), having failed every run for two reasons measured
on 2026-09-01, both now recorded where they bite: TLS to `api.gdeltproject.org` is reset from the
development network path while the identical plaintext request answers 200 — a network path
failure, not GDELT refusing a caller, so the seeded endpoint requests over plaintext — and DOC's
indexing lag is variable enough that the `1h` window #46 shipped is empty whenever GDELT falls
behind, so the seeded `timespan` is now `3h`, wide enough for the lag and far enough from the
250-record cap to leave headroom as volume moves. Both bounds are argued once, in
`seedData/corpus.ts`; everywhere else points there rather than restating a measurement that
moves. A missing `articles` key is GDELT's zero-match answer, not the block signal the parser
read it as; refusal still arrives as a non-JSON body and still fails the run loudly. The live run
behind `GDELT_LIVE_SMOKE=1` now asserts a completed run that inserted Articles, since neither
cause is expressible in a fixture (that flag also serializes test files, since two of them pace
against the one rate-limited endpoint).
The **Guardian feed** is fixed alongside it (#61): fast-xml-parser caps entity expansions at 1,000
*per document*, which is a function of a feed's legitimate size — the Guardian World feed carries
2,024 ordinary `&amp;`/`&#8217;` references across 45 items and tripped it at 1,008, so one of the
ten curated feeds had failed every run. `processEntities` is now explicit in `src/ingestion/rss.ts`:
the count is raised to admit a real feed, while the three bounds that actually stop entity
amplification (one entity's size, nesting depth, total expanded characters) are restated at their
documented defaults, because passing the object form defaults two of them to Infinity. An
untouched 153 KB capture of the live feed drives it offline.
The **Curated Corpus now carries its own GKG Annotations** (#62), the permanent half of a graph
whose firehose half rolls over weekly (ADR-0028, ADR-0029): every fixture Article's body was
extended to name people, organizations and places, and `src/seedData/annotations.ts` authors
person/organization/location/theme occurrences against it — anchored on a substring rather than a
hand-written offset, so the offset is *derived* at seed time and an annotation naming something the
body does not say throws instead of seeding. Persons and organizations are invented like the
reporting they sit in; locations are real, because a location annotation carries gazetteer detail
and inventing coordinates would make the map view lie (the FeatureIDs are invented and stable —
nothing resolves against a real gazetteer yet). Names recur across Articles and Stories on purpose.
Staged through the connector's own `stageAnnotations`, now exported, so occurrence identity is one
implementation and a re-seed stages nothing twice; retention was already excluding fixture rows
three times over and the seed suite now asserts that consequence directly. Because a body is now
load-bearing for its own annotations, `seedCorpus` converges the text of a Story it already holds
— re-embedding only the Articles it replaced — so a database seeded before this ticket catches up
rather than throwing on the first anchor it cannot find.
**Readability extraction** (#47) closes ADR-0018's fourth surface and is a connector kind of
its own (`readability`, `src/ingestion/readability.ts` over `@mozilla/readability` + `linkedom`):
it discovers nothing, it re-reads pages Tessera already holds an excerpt for and raises them to
`api_content` — text `mayServeText` refuses to serve whatever the Terms Class, since no
publisher handed it to us. Candidates are RSS-discovered Articles still on the excerpt rung
that arrived without a body and have never been attempted (`articles.extractionAttemptedAt`),
20 per run, one request per publisher domain every 2 seconds; GKG and DOC rows are excluded by
kind *and* by rung, and so is any Article whose Publisher already had its excerpt cleared for
serving. A paywall, a bot block, or a body no longer than the excerpt it would replace is a
counted failure that leaves the Article where it was, so a run's ledger still sums to
`discovered`.
Phase 3 has started with the **clustering tracer bullet** (#49): `src/clustering/`
(`runClustering` is the one new seam, over `config.ts`'s two tunables) embeds eligible Articles
in batches, recomputes every Story's centroid from its members, assigns an Article to the
nearest live Story above the similarity threshold, and seeds a new Story from two
mutually-matching Articles from two distinct Publishers — never one, and never into or out of
the Curated Corpus, which `manual_fixture` closes in both directions. Eligibility is
`feed_excerpt` or above, so the firehose's `metadata_only` rows are never clustered and keep
aging out. A new Story is **named** by one model call over its members' headlines (#51 —
`src/clustering/naming.ts` over the shared synthesis provider; headlines only, so no body text
leaves for it), made once after the seeding transaction commits and never for a Story that
already exists. A failed call, a 15-second timeout, or a category outside the eight-value
vocabulary leaves the medoid Article's title and the `world` default in place and the run still
succeeds; with no key the Mock answers `[mock] <headline>`. Naming is clustering's one
non-deterministic step: a re-run reproduces membership, not titles.
Enrichment nulls `articles.embedding` when it writes new text, so a null
vector means one thing. Operationally it is a second BullMQ queue on the same worker process,
ticking hourly at :05, with an Admin-only `POST /api/v1/clustering/runs` that answers
`202 {status:"accepted"}` and a `clustering_runs` history table.
**Pending review** (#50) opens the band beneath the threshold: a score between the fixed
review floor (0.10 below the auto-accept threshold) and the auto-accept threshold is held as a *proposal* —
`articles.storyAssignmentStatus = 'pending_review'`, carrying the Story's id so a reviewer can
see what is proposed, but changing neither the Story's centroid nor its span. So `storyId IS NOT
NULL` no longer means membership: `lib/storyMembership.ts` holds the one predicate every reader
surface now tests (browse, Story detail, Article detail, search, Brief evidence, the Investor
rollup), a DB CHECK makes a storyId without a decision impossible, and the run ledger sums
`assigned + heldForReview + seeded + unclustered = considered`. `GET /api/v1/clustering/pending`
and `PATCH /api/v1/clustering/pending/:articleId {decision}` are the Admin-only queue and
decision; accepting makes the Article a member and recomputes the Story, rejecting returns it to
Unclustered and remembers the pairing in `rejected_story_assignments` so no later run proposes
it again. A run also voids any proposal whose vector enrichment has cleared, since a score
describing replaced text is not a judgement anyone should be shown, and rescores the Article in
the same pass.
**Story merge** (#52) is the correction the tight threshold makes necessary, and the one Admin
command here that is not an enqueue: `POST /api/v1/clustering/merges {survivorStoryId,
mergedStoryId}` (`src/clustering/merge.ts`) moves every Article to the survivor with its
decision intact — a proposal stays a proposal, for the survivor now, rescored against the
survivor's recomputed centroid (unscored where there is nothing to compare, since a run never
rescores a proposal) — recomputes the survivor's
centroid and span from the merged membership, and *deletes* the emptied row rather than
tombstoning it, guarded by a leftover check because `articles."storyId"` cascades on delete. It
refuses a self-merge, an unknown Story, and either side being in the Curated Corpus, which
ADR-0026 closes in both directions. A Brief is untouched: evidence pins Articles, not Stories.
The **generation tracer bullet** (#53) is the flagship, thinly: `POST /api/v1/stories/:id/analysis`
(`src/generation/`, `runGeneration` is the one new seam) selects evidence deterministically —
ranked by distance to the Story centroid, ≤10 Articles, ≤2 per Publisher, earliest and latest
forced in, pending assignments and text-free rows excluded — freezes it as an **EvidenceSet**
with stable `A1…` ids, ~1500-character excerpts and a SHA-256 over each Article's *full*
analysis text, then asks a cheap model for claims under the one **Lens** the caller's role
implies (an Admin names it). Validation sits below the prompt and is non-tunable: an uncited
claim, or a citation naming an id outside the frozen set, fails the run (`invalid_citations`);
unparseable or off-contract output fails it structurally; a hash that no longer matches at
persist fails it too. Every attempt persists — status, prompt version, the provider that
answered, raw answer and a `validationResult` counting what the model returned, kept and cited
that does not exist — and a repeat request for the same evidence, Lens, prompt version *and*
provider returns the existing run instead of paying twice, so a Mock-written analysis is never
served after a key is configured. It is synchronous, so a failed run is a 200 carrying
`status:"failed"` and a reader-safe `failureCode`; the provider's own message stays on the row.
**The validation contract** (#54) is what makes a cheap model publishable. A candidate too
similar to an already-selected member is skipped after ranking, so five outlets running one wire
report stop counting as five sources — the Articles stay, `distinctPublisherCount` counts
newsrooms, and a Story that is *only* wire copy collapses to one publisher and is refused
before anything is frozen (v3 §16.2's minimum of two). The EvidenceSet records its weakest
rung (`evidence_sets.dataMode`; `manual_fixture` ranks as full text, being our own complete
seed body), and below full text the prompt carries v3 §16.6's wording while validation rejects
omission phrasing outright — with investment advice and price targets rejected under *every*
Lens, and a `contradiction` rejected unless its citations resolve to two distinct Publishers.
A failing claim is now **dropped and recorded**, not fatal: the run completes if at least two
claims survive including one `consensus` *and* one claim of the run's own Lens — an Investor
analysis whose implication was dropped is a Student's analysis with an Investor's name on it
(ADR-0004) — and fails otherwise (`invalid_citations` when claims
were refused, `below_claim_floor` when the answer was merely thin). Structural failures still
fail whole. Before any failure, the answer is re-prompted twice with the specific validation
error and the rejected text (`repairAttempts` on the run, `SYNTHESIS_TIMEOUT_MS` now the budget
for *all* the calls, so a reader's wait is unchanged). Every failure mode is driven by a
transcript of the configured model's own bad answer in `tests/fixtures/synthesis/`, with one
live check behind `SYNTHESIS_LIVE_SMOKE=1`.
**Saving an analysis** (#55) closes the ownership loop, on the endpoint that already
existed: `POST /api/v1/briefs` takes an optional `generationRunId`, and with it the Brief is
pre-filled with the Story's title and category, pins the EvidenceSet's Articles (without the
accepted-membership check the manual attach applies — each one was an accepted member when its
evidence was frozen) and references that exact run through a nullable
`intelligence_briefs."generationRunId"`. Brief detail serves the frozen claims through
generation's own `loadGenerationView`, so a saved analysis reads identically to the one that was
saved and keeps reading that way after its Story is analysed again. Same endpoint means the same
rules: the Student/Investor guard refuses an Admin here as everywhere else on `/briefs`, and the
article capacity refuses a Brief smaller than the analysis cites rather than pinning part of it.
A failed run cannot be saved at all, nor can a run written under a Lens that is not the caller's
own — saving is the second door into the same claims, so it applies the rule the generation
endpoint applies at the first. A Story merge now repoints `generation_runs` and
`evidence_sets` at the survivor instead of letting `storyId`'s cascade delete a reader's saved
analysis with the emptied row.
**The Investor Lens** (#56) is a reading of that output rather than a second pipeline, so the
backend half is one query: the Investor dashboard now carries `comparableStories` — the Stories
evidence selection would accept, newest movement first, capped at 10 — under the same conditions
generation applies (accepted membership, analysis text, an embedding, ADR-0027's two distinct
Publishers after near-duplicate collapse), so a row an Investor opens is a Story an analysis can
be written about. It carries no article count, deliberately: the members eligible here are a
subset of the accepted members `/stories` counts, and one word for two numbers would be a defect.
**Admin prompt tuning** (#57) makes the prompt data: a `prompt_templates` row carries a version
label and four parameters — register, claim count, Lens emphasis, which core claim types are
asked for — and `src/generation/template.ts` is the whole surface, reading the current one and
deciding whether a proposed one may exist. Rows are immutable and never deleted, so tuning is
*creating* a version (`POST /api/v1/prompt-templates`) and activation is the only mutation
(`PATCH .../:id {isCurrent: true}`, at most one current by partial unique index) — which is what
keeps `generation_runs.promptVersion` resolving to the parameters that wrote a past run.
Invalidation is free: the version is already in the reuse key, so the version just activated has
no runs and the next request regenerates. ADR-0021's guardrail is enforced by what the boundary
refuses, not by a note — a claim count below validation's own floor, or a surfaced set without
`consensus`, is refused at the API because every run under it would fail below the prompt, and
tuned text is flattened to one bracket-free line so it cannot pose as further instructions. There
is deliberately no field for the citation check. The shipped version is inserted by the
migration, not the seed (the flagship reads it on every request), and carries exactly the prompt
this pipeline asked for before it was tunable, so applying #57 changed no output.
**Student flashcards** (#58) reuse the validated analysis rather than creating a second generation
contract: a `Flashcard` is a Student-owned question pointing at one `AnalysisClaim`, so its answer
and citations are the claim's own and still resolve through that run's frozen EvidenceSet. One
model call writes only the questions; unusable output falls back to deterministic questions over
the same cited answers. `POST /api/v1/flashcards {generationRunId}` makes or re-reads a deck from
either a Story analysis or a saved Brief analysis without resetting prior reviews, `GET
/api/v1/flashcards` serves the due session, and `POST /api/v1/flashcards/:id/reviews {grade}`
advances the card with canonical SM-2 while persisting the submitted grade and resulting schedule.
Question synthesis is shared through `flashcard_question_cache`, keyed by a SHA-256 of immutable
claim type + text, so another Student studying the same analysis does not repeat the model call.
Every route is Student-only and every query is owner-scoped.
Phase 3.5 has started with the **entity resolution tracer bullet** (#66): `src/graph/`
(`runEntityResolution` is the one new seam, over `config.ts`'s two env-read tunables) folds every
promotable GKG Annotation to a normalized name in Postgres — case, punctuation and whitespace,
one exported SQL fragment used identically on insert and lookup, so promotion and every later
lookup search the same fold — promotes the names cited by at least `GRAPH_ENTITY_PROMOTION_FLOOR`
distinct Articles (5) to `entities`, and rebuilds the whole co-occurrence graph. Themes are never
nodes (ADR-0028); a location's identity includes GKG's FeatureID, so two Springfields stay two
Entities. Promotion is `ON CONFLICT DO UPDATE`, so an Entity that stays promoted keeps its id
across passes and the displayed name follows the commonest surface form as the window rolls; an
Entity whose annotations have aged out of the retained window is *demoted* — deleted — because the
graph is rolling. The **citation invariant** is structural, not maintained: `entity_edges` holds one
row per (pair, Article) with `ON DELETE CASCADE`, so an edge's weight is a count at read time and
deleting an Article cannot leave an uncited edge behind (asserted directly, not trusted to the
cascade). Edges are bounded at `GRAPH_EDGES_PER_ENTITY` (25) per Entity, strongest first, from
*both* ends: a pair survives if it ranks within the bound for either endpoint, so a node never
loses its own strongest neighbour for being that neighbour's 26th. The whole pass is one
transaction, so a reader sees the previous graph until it commits and a failure leaves that graph
intact — which, with stable ids, is what makes a re-run over unchanged annotations produce the same
Entities and the same edges. Operationally it is a third BullMQ queue on the same worker process,
ticking hourly at :20 (clear of the quarter-hour ingestion ticks, after clustering's :05), with an
Admin-only `POST /api/v1/graph/resolution-runs` answering `202 {status:"accepted"}` and an
`entity_resolution_runs` history table whose ledger is `promoted + belowFloor = considered`.
Nothing *reads* the graph yet: the Cytoscape view (#68, #69) and fuzzy candidate merges with
their review queue (#67) are still ahead — as is ADR-0028/ADR-0029's groundwork behind them, the
restored DOC connector (#60), the fixed Guardian feed (#61) and the annotated Curated Corpus
(#62) above.
**A Story's timeline** (#64) is the phase's other read view, and it costs nothing per view:
`GET /api/v1/stories/:id/timeline` assembles it from rows that already exist, so no model writes
any part of it (ADR-0020). The seam is `src/timeline/buildTimeline.ts`, and it takes a **set of
Articles**, never a query — the search timeline (#65) lays Articles drawn from many Stories on
one axis grouped into a lane per Story, and bucketing each lane against its own span would stop
parallel events reading as parallel, so `storyId` rides on every point. The axis spans the
reporting *and* the analytical events on it — an EvidenceSet freeze and a completed
GenerationRun, the two things that happen *to* a Story — and its granularity is chosen from that
span (hour, then day, then week, the finest that keeps the volume overlay under 60 bars), with
zero-count periods kept, because a lull in coverage is a fact about the Story. Only accepted
members reach it, by the same `lib/storyMembership.ts` predicate every other reader surface
tests; a failed GenerationRun is left off, having produced nothing. Tone is deliberately not an
axis: `articles.tone` is GDELT's and reaches a clustered Story only by cross-connector
enrichment, which measured zero, so the register says so in a line rather than drawing an empty
one.
**Search anything, read it as a timeline** (#65) is that seam's second consumer, and it is two
reuses rather than any new machinery: `GET /api/v1/search/timeline` and `GET /api/v1/search` share
one `matchesFor` — one accepted param vocabulary, one call into `hybridSearchArticleIds`' fused
lexical⊕semantic ranking, one load of the Articles behind the hits — so the two readings of a
query cannot disagree about what matched, and the axis is the one `buildTimeline` already draws.
It groups the matches into **one lane per Story** via `toLanes`, which buckets each Story against
the *shared* axis' buckets, index for index (`bucketOf` is the one bucket-index definition both
use): two Stories reported in the same week land in the same column and read as parallel, which
is precisely what a per-lane `buildTimeline` call would destroy. Lanes come back in first-report
order, so the page reads down in the order the events themselves began, each naming its Story
with the same `{id, slug, title}` projection a result row carries. Accepted membership is not
re-implemented here either — search joins through it, so the firehose stays invisible for the
reason it is invisible on `/search` (ADR-0028). One deliberate ceiling: an axis is a *set* and so
cannot page, so the endpoint takes the most relevant matches up to `TIMELINE_MATCH_CAP` (200) and
returns the true match count beside them, which the page states — span included — rather than
hides. No analytical events ride this axis — they are facts about one Story's history, and a
lane's heading routes into that Story to read them (#64). The endpoint accepts `/search`'s whole
param vocabulary, `sort` included (where it only chooses which matches survive the cap), so a
reader switching readings with their own URL never hits a 422.
**frontend/** — `src/App.tsx` is the route table alone; chrome comes from `components/AppShell.tsx`.
Live, `fetch`-based pages (`src/api/client.ts`) cover health (`/status`), auth (`/login`,
`/register`, `/account`), role dashboards (`/dashboard/:role`), browsing the corpus
(`/stories`, `/stories/:id`, `/articles/:id`), IntelligenceBriefs (`/briefs`, `/briefs/:id`),
search (`/search`, `/search/timeline`), and the Student study session (`/study`). The
**Bureau rollout** (#28) is mid-flight: root design tokens and the
application shell (#29), the four shared UI-state treatments and restyled list controls (#30),
and the Index archetype across all three of its consumers — `/stories` (#31), `/briefs` and
`/search` (#32) — are done, as is the Record archetype across all three of its consumers:
Story and Article detail (#33) and Brief detail as the owned artefact (#34), and the Form
archetype across registration, sign-in, and the Brief form — which gained its own
cover-image control (#35), and the Dashboard archetype across all three roles (#36).
The cross-route responsive and accessibility sweep (#37) closed it out: `/account` and
`/status` became stated pages in the same vocabulary, and every route's screenshots at both
breakpoints sit in `docs/verification/bureau-rollout/`. `/` redirects to the caller's own
dashboard. Story detail's coverage register *is* the **timeline** (#64):
`components/timelineRegister.tsx` — shared, because #65 draws the same thing over a search — is
the volume overlay over the reporting and the analytical events interleaved in time order, each
Article row still the Index archetype's own entry opening its Article, each event row naming
itself over its ledger. It folds in the Articles register #33 shipped rather than listing the
same rows twice, and owns its own request and so its own four states: a Story with no datable
reporting says that, and a failed request says *that* while still listing the Articles off the
record this page already loaded. `pages/SearchTimeline.tsx` at `/search/timeline` is the Index
archetype's fourth surface and that register's other consumer (#65): the same filter register and
the same Article rows, but what it registers is a `<section>` per Story rather than a ranked list,
each headed by a link into the Story, each drawing its bars through the shared `TimelineVolume`
against one page-wide `peak` so a tall bar means the same count in every lane. `/search` and it
are one address bar — `useListQueryParams` hands over `queryString` whole, so `Read as a timeline`
and `Read as a ranked list` switch the reading without re-typing the query, and `q` survives Clear
filters on both. Story detail carries the **analysis surface** (#53): a Request-analysis command (a
mutation, never a fetch on render, since an analysis may cost money), a Lens select for an Admin
only — a reader's Lens is their role, and the API refuses one from them — claims grouped by kind
in the record's note register with each citation an `A1 · Publisher` link to the Article it
resolves to, and a stated unavailable panel — worded per `failureCode` — for a run that failed
rather than any part of it. A completed analysis carries a **Save to a new Brief** command (#55)
for the two roles that own Briefs — never for an Admin, whom the API refuses — landing the reader
on the Brief they now own; Brief detail carries the saved analysis as its own register, rendered
by the register both records share (`components/analysisRegister.tsx`), stated as frozen. That
shared register reads differently under the two Lenses (#56), off the analysis's own `lens` so a
saved investor analysis keeps its reading in a Brief: agreement, then disagreement, then the
implication, with single-source reporting last; each consensus claim states the Publishers it was
cited to out of the set's own count; a contradiction is rendered as its **sides** — one factual
proposition with supporting and contradicting citations persisted below the prompt, each carrying
its Publisher, headline and link to open it — instead of a flat citation row; and the disagreement
register is kept even when it is empty and says so, since a contradiction can be refused for
missing a side (#54) and silence would read as agreement. For a Student the shared register also
carries **Make flashcards** (#58), whether the analysis is fresh on a Story or frozen in a Brief;
it lands on `/study`, which presents one due card at a time, hides the cited answer until recall,
then records Again/Hard/Good/Easy as SM-2 grades. The surface uses all four shared UI states and
states the difference between no cards and nothing due. The Investor dashboard gained a second
register routing into it (**Comparable coverage**), listing only Stories whose evidence still
holds two Publishers after the same near-duplicate collapse generation runs. The Admin console gained a fourth register for **IngestionRun** history and Run /
Enable-Disable commands on each connector row (#39 — Run states that it queued the run, since
the worker is what executes it, #42), and each publisher row shows its Terms
Class beside its article count (#40). A fifth register carries **ClusteringRun** history with a
Run-clustering command on the register itself (#49 — one pass over the whole corpus, so there is
no row to hang it on), a sixth carries **EntityResolutionRun** history with a Run-resolution
command for the same reason (#66 — Annotations, Articles, Considered, Promoted, Below floor,
Demoted and Edges per row; it too states that it *queued* the pass, since the worker is what
promotes and connects), and a seventh is the **clustering review queue** (#50) — the one register
with its own request, so it owns all four UI states, with Accept/Reject on each proposal row. An
eighth is **Story merge** (#52), the console's one command *form*: two selects over the 50 most
recent Stories (its own request, refetched after a merge since one of the pair is gone), a Merge
command refused client-side for a Story named twice, and a stated note reporting what the merge
did rather than what it queued. A ninth is **Prompt versions** (#57), a register and a second
command form: each version states its own parameters in the note line so two can be told apart
without opening either, a Make-current command on every row but the current one, and a form whose
fields are the whole tuning surface — there is no control for the citation check, because it is
not configuration. Those five Phase-3 registers live in `pages/adminRegisters.tsx`, each owning
its own request and commands; `pages/AdminDashboard.tsx` is the console that lays them out and
the two registers reading its own payload. The
**design prototype** for the Phase-3 flagship (`src/versions/BureauPrototype.tsx` +
`bureau.tsx` over hardcoded `src/data.ts`, styled by `src/styles.css`) sits at
`/design-prototype`, out of the Phase-1 path.

`npm run migrate` (backend) applies migrations; `npm test` (backend) is the API-seam test
pattern (supertest + an ephemeral Testcontainers Postgres) later Foundation tickets extend.

