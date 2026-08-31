# AGENTS.md

**Tessera** — evidence-grounded news intelligence workspace. Course capstone
(Node/Express/TypeORM/PostgreSQL/React, JWT+RBAC) that is also the foundation of a real product.

## Quick start

1. Read `CONTEXT.md` for the domain glossary — use these exact terms.
2. Read `docs/adr/` (27 ADRs) — **these override the spec** where they conflict.
3. Read `project-docs/Tessera_Master_Build_Specification_v3.md` — the full product spec.
4. Read `project-docs/project-statement.md` — non-negotiable course requirements.
5. Read `project-docs/Tessera_Initial_Report.md` — the capstone initial report (submission-ready).

> `project-docs/ai-news-intelligence-spec.md` is a **superseded early draft** (Python/FastAPI/
> Kafka/Neo4j/Next.js-SSR). Do NOT build from it. See ADR-0005.

## Repo state

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
looks like a bot or asks too often (measured: it drops the TLS connection rather than answering);
a full 250-record response is stated as **truncated** on the run rather than reported as
complete; and artlist carries no body or snippet at all, so DOC rows land on the same
`metadata_only` rung as GKG's and are pruned by the same retention pass (now
`pruneExpiredGdeltArticles`, covering both GDELT kinds).
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
claims survive including one `consensus`, and fails otherwise (`invalid_citations` when claims
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
Publishers), so a row an Investor opens is a Story an analysis can be written about. It counts
mastheads, not newsrooms: the wire-copy collapse is per EvidenceSet and over vectors, so a Story
that is one wire report twice can still be listed and is refused on opening with the reason
stated — which is why the register says Publishers and never promises an analysis. It carries no
article count, deliberately: the members eligible here are a subset of the accepted members
`/stories` counts, and one word for two numbers would be a defect.
Phase 3.5 (graph/timeline) is not built yet.
**frontend/** — `src/App.tsx` is the route table alone; chrome comes from `components/AppShell.tsx`.
Live, `fetch`-based pages (`src/api/client.ts`) cover health (`/status`), auth (`/login`,
`/register`, `/account`), role dashboards (`/dashboard/:role`), browsing the corpus
(`/stories`, `/stories/:id`, `/articles/:id`), IntelligenceBriefs (`/briefs`, `/briefs/:id`),
and search (`/search`). The **Bureau rollout** (#28) is mid-flight: root design tokens and the
application shell (#29), the four shared UI-state treatments and restyled list controls (#30),
and the Index archetype across all three of its consumers — `/stories` (#31), `/briefs` and
`/search` (#32) — are done, as is the Record archetype across all three of its consumers:
Story and Article detail (#33) and Brief detail as the owned artefact (#34), and the Form
archetype across registration, sign-in, and the Brief form — which gained its own
cover-image control (#35), and the Dashboard archetype across all three roles (#36).
The cross-route responsive and accessibility sweep (#37) closed it out: `/account` and
`/status` became stated pages in the same vocabulary, and every route's screenshots at both
breakpoints sit in `docs/verification/bureau-rollout/`. `/` redirects to the caller's own
dashboard. Story detail carries the **analysis surface** (#53): a Request-analysis command (a
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
cited to out of the set's own count; a contradiction is rendered as its **sides** — the outlets
grouped, each carrying the headline it cited and a link to open it — instead of a flat
citation row; and the disagreement register is kept even when it is empty and says so, since a
contradiction can be refused for citing one Publisher (#54) and silence would read as agreement. The Investor dashboard gained a second register routing into it (**Comparable
coverage**), listing the Stories two or more Publishers have citable reporting on — mastheads, not
newsrooms, since the wire-copy collapse happens when an EvidenceSet is frozen, so a Story that is
one wire report twice is listed and refused on opening with the reason stated. The Admin console gained a fourth register for **IngestionRun** history and Run /
Enable-Disable commands on each connector row (#39 — Run states that it queued the run, since
the worker is what executes it, #42), and each publisher row shows its Terms
Class beside its article count (#40). A fifth register carries **ClusteringRun** history with a
Run-clustering command on the register itself (#49 — one pass over the whole corpus, so there is
no row to hang it on), and a sixth is the **clustering review queue** (#50) — the one register
with its own request, so it owns all four UI states, with Accept/Reject on each proposal row. A
seventh is **Story merge** (#52), the console's one command *form*: two selects over the 50 most
recent Stories (its own request, refetched after a merge since one of the pair is gone), a Merge
command refused client-side for a Story named twice, and a stated note reporting what the merge
did rather than what it queued. The
**design prototype** for the Phase-3 flagship (`src/versions/BureauPrototype.tsx` +
`bureau.tsx` over hardcoded `src/data.ts`, styled by `src/styles.css`) sits at
`/design-prototype`, out of the Phase-1 path.

`npm run migrate` (backend) applies migrations; `npm test` (backend) is the API-seam test
pattern (supertest + an ephemeral Testcontainers Postgres) later Foundation tickets extend.

## Stack (decided — do NOT scaffold the old spec's stack)

| Layer | Tech | ADR |
|---|---|---|
| Backend | Node/Express + TypeORM + PostgreSQL (+pgvector) | 0005 |
| Queue/worker | Redis + BullMQ | 0005 |
| Graph | Plain Postgres tables + recursive CTEs (NO Neo4j) | 0019 |
| Embeddings | Hosted API @ `vector(1024)`; TEI/bge-m3 optional local | 0017, 0023 |
| Ingestion | GDELT GKG 15-min firehose + DOC API + RSS + Readability | 0018 |
| Frontend | Vite + React SPA; Cytoscape.js for graph view | 0005, 0019 |
| LLM | Cheap OpenAI-compatible models via env config + Mock provider | 0003 |
| Local demo | Docker Compose (Postgres+pgvector, Redis); app runs natively | 0015, 0023 |

**NO:** Kafka, Python/FastAPI, SSR, Neo4j, separate vector DB, hardcoded model IDs.

## Locked decisions (see docs/adr/ for full rationale)

- **ADR-0001** Course-first scope, startup-shaped architecture.
- **ADR-0002** Flagship = frozen-evidence cited synthesis.
- **ADR-0003** Cheap OpenAI-compatible models via env config + validate-and-repair loop. No hardcoded model IDs. Mock provider required.
- **ADR-0004** Three genuinely distinct roles (Admin/Student/Investor) — different endpoints & data.
- **ADR-0005** Node/Express + TypeORM + PostgreSQL backend; Vite + React SPA; Redis + BullMQ; NO SSR; NO Python.
- **ADR-0017** Embeddings @ `vector(1024)`, HNSW cosine, provider-swappable within the 1024
  Matryoshka family. (Serving default revised by ADR-0023.)
- **ADR-0018** Ingestion: GDELT GKG firehose + DOC API + RSS + Readability. Metadata open; bodies internal-only.
- **ADR-0019** Knowledge graph: GKG-backed, bounded (~50–200 nodes), co-occurrence edges in plain Postgres. No Neo4j. Typed relations deferred.
- **ADR-0020** Timeline: read view over Stories (evolution only, not alerting).
- **ADR-0021** Role features: Student flashcards, Admin PromptTemplate tuning, Investor consensus/contradiction.
- **ADR-0022** Build order: Foundation → Ingestion → Flagship → Phase 3.5 (graph+timeline) → Eval.
- **ADR-0023** Embeddings served by hosted API (demo machine has ~3 GB free RAM); TEI optional.
  Bodies to the embedding provider is a documented exception to ADR-0018; synthesis evidence
  text stays on the paid no-training provider.
- **ADR-0024** Analysis Text Mode is an ordered ladder (`metadata_only` < `feed_excerpt` <
  `api_content` < `licensed_full_text`); modes only move up. Same canonical URL across
  connectors is *enrichment*, not duplication.
- **ADR-0025** Embeddings and synthesis share one OpenAI-compatible retry transport;
  query/passage marking is load-bearing; rate limits count requests, so batch.
- **ADR-0026** Clustering: one similarity knob with time as a hard gate, no singleton Stories,
  membership on `articles`, centroid recomputed per run, Curated Corpus closed both ways.
- **ADR-0027** Generation: deterministic evidence selection, partial claim acceptance with a
  floor, repair rather than a model-escalation ladder; one Lens per GenerationRun.

## Build order (ADR-0022)

1. **Foundation** — auth, RBAC, IntelligenceBrief CRUD, search, all UI states, seeded demo.
2. **Ingestion** — GKG firehose + DOC + RSS + Readability; dedup, rights checks.
3. **Flagship** — clustering → evidence freeze → cited synthesis → 3 claim types → citation validation → role features.
4. **Phase 3.5** — entity resolution, co-occurrence graph, Cytoscape view, timeline read view.
5. **Eval** — clustering precision/recall, generation pass-rate.

## Core invariants (must survive refactors)

- **No displayed claim without a valid citation** into its generation's frozen EvidenceSet — enforced in backend code, below the prompt, non-tunable.
- Every **EntityEdge** carries its `source_article_id` — uncited edges are bugs.
- Entity resolution uses a **confidence threshold**; borderline merges queue for Admin review.
- EntityEdges are **co-occurrence**, not typed relations (typed relations deferred).
- Cache LLM calls by `content_hash`; batch where possible.
- GDELT/API **metadata** is storable; article **bodies** are internal only, and are served
  only where a Publisher's **Terms Class** clears them by hand (#40) — never for
  `api_content`, which Tessera extracted itself. Two documented exceptions to bodies staying
  internal: the hosted embedding provider (ADR-0023), and synthesis evidence text, which goes
  only to the paid, contractually no-training provider (ADR-0003).

## Working conventions

- **ADRs override the spec.** Where v3 and `docs/adr/` conflict, the ADR wins.
- **Phased delivery.** Follow ADR-0022 exit criteria; don't jump ahead.
- **No SSR.** Vite + React SPA only (ADR-0005).
- When you introduce `package.json`, a `Dockerfile`, or CI, add verification commands here.

## Agent skills

Load via the `skill` tool. Key ones for this project:

| Skill | Use when |
|---|---|
| `hallmark` | Building/redesigning/auditing any page or component |
| `tdd` | Writing tests for features or fixes |
| `implement` | Implementing from a spec or tickets |
| `diagnosing-bugs` | Debugging something broken/throwing/failing |
| `code-review` | Reviewing changes since a commit/branch |
| `grilling` | Stress-testing a plan or design |
| `to-spec` | Turning conversation into a spec/issue |
| `to-tickets` | Breaking work into tracer-bullet tickets |
| `research` | Delegating research to a background agent |
| `handoff` | Compacting conversation for another agent |
| `domain-modeling` | Sharpening domain terminology |
| `codebase-design` | Finding deepening opportunities in modules |
| `resolving-merge-conflicts` | Fixing git merge conflicts |
| `caveman-commit` | Writing any commit message — use it for every commit |

Full list: 35 skills in `.agents/skills/` — see `ask-matt` if unsure which fits.
Skills are pinned in `skills-lock.json` (`.agents/`+`.claude/` are gitignored); restore with
`npx skills experimental_install`, refresh with `npx skills update -p`.

### Issue tracker

GitHub Issues on `kohilsharma/tessera`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`), unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Plugins

| Plugin | Purpose |
|---|---|
| **ponytail** | Lazy senior dev mode — forces simplest working solution (default: full) |

## Available MCPs

| MCP | Type | Purpose |
|---|---|---|
| **serena** | local (uvx) | Language server: symbol navigation, find references, project indexing |
| **context7** | local (npx) | Up-to-date library documentation for frameworks/SDKs |
| **exa** | remote | Web search and page fetch via exa.ai |

## Verification

Frontend commands (run from `frontend/`):

```bash
npm run build
npm run dev
npm test          # vitest + jsdom + React Testing Library; the secondary seam
                  # (list/search views, Brief form, auth flow) over the four UI states
```

No frontend lint script exists yet. Do not claim it passes until implemented.

Backend commands (run from `backend/`, after `docker compose up -d` — see `SETUP.md`):

```bash
npm run dev       # tsx watch, http://localhost:4000
npm run worker    # tsx watch, the worker: drains both BullMQ queues — ingestion, ticking every
                  # 15 minutes (#42), and clustering, ticking hourly at :05 (#49). Needs
                  # REDIS_URL; run it in a second terminal.
npm run build     # tsc -> dist/
npm run migrate   # apply TypeORM migrations
npm run seed      # demo users for all three roles (only path to an Admin, ADR-0015) + the
                  # Story/Article/Publisher corpus + one owned Brief with a cover image +
                  # 10 curated real RSS connectors + the enabled GKG firehose (#39, #41) +
                  # the enabled DOC API connector carrying its query (#46) + the enabled
                  # Readability extraction pass (#47);
                  # embedded with the configured hosted provider when its key +
                  # model are set, else the Mock (ADR-0025 — switching providers
                  # needs a fresh volume, see SETUP.md)
npm test          # vitest; spins up an ephemeral Postgres via Testcontainers, needs docker access
                  # No Redis in the test stack: the enqueue is stubbed (#42, #49)
                  # GDELT_LIVE_SMOKE=1 additionally runs the two live GDELT checks — the GKG
                  # window (#41) and the DOC query (#46) — skipped by default so the suite
                  # stays offline
                  # SYNTHESIS_LIVE_SMOKE=1 runs the one live synthesis check (#54), which reads
                  # SYNTHESIS_* out of backend/.env by hand: vitest.config.ts pins those keys
                  # empty so nothing else can reach a provider by accident
```

No lint script exists yet. Do not claim it passes until implemented.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
