# Phase 2 — Ingestion

RSS, the GDELT GKG firehose, the DOC API and Readability extraction, all behind `runConnector`.

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
`discovered`. Its transport was broken from the day it shipped and was repaired in #70, below.
