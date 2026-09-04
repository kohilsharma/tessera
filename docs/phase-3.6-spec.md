# Phase 3.6 — Product overhaul

Status: agreed 2026-09-03 by interview. Inserted ahead of ADR-0022's Phase 4 (eval harness), which
now runs after this phase, not before it.

## Context

Phases 1–3.5 built a backend that works and a frontend nobody wants to use. A full walkthrough of
the running app produced one verdict: *"the whole website needs an overhaul"* — no colour, no
icons, no animation, no interactivity, features that exist but cannot be found, and pages that grow
without bound until they lag. Several complaints turned out to be real defects rather than taste.

The backend is sound. This phase rebuilds the product on top of it: a new design system, four
feature builds, four system-design additions, and a sweep of the bugs the walkthrough surfaced.
The exit criterion is the user's own: **a complete product they are satisfied with**, demoable
end to end.

---

## 1. Design system

### 1.1 Retire Bureau

`DESIGN.md`'s "Evidence Registration Bureau" is withdrawn. Its rules — no ambient depth, no
decorative motion, no colour without meaning, no icons — produced Arial on beige with one keyframe
in the whole application. The lesson recorded in the ADR is not "be louder": **a design system made
only of prohibitions produces nothing.**

Delete: the `.design-bureau` block in `frontend/src/styles.css` (~35% of the file, reachable from no
route), `src/versions/BureauPrototype.tsx`, `src/versions/bureau.tsx`, `src/data.ts`, and the
`/design-prototype` route. Keep `docs/verification/bureau-rollout/` as evidence the rollout happened.

Keep from Bureau: the four page archetypes (Index, Record, Form, Dashboard), the four UI states per
route, and the shared-register principle — what two pages both draw lives in one place.

### 1.2 The token contract

Every theme declares the **same fifteen custom properties**; only values differ. A component that
reaches for `var(--agree)` is correct under all of them, which is what stops the themes drifting
apart:

```
--paper --paper2 --ink --quiet --rule --rule2
--left --centre --right
--agree --diverge --imply
--wash-agree --wash-diverge --wash-imply
```

`--focus` is added to the contract (Newsroom already carries it).

### 1.3 Three role themes

Theme is a property of **who you are**, not a preference. It is set from the signed-in role and is
not user-overridable.

| Role | Theme | Display / UI type | Ground · Ink (light) |
|---|---|---|---|
| Admin | **Newsroom** | Instrument Serif / Archivo | `#faf8f4` · `#16140f` |
| Investor | **Terminal** | IBM Plex Sans / Spline Sans Mono | `#0b0e11` · `#dde5ec` (dark by nature) |
| Student | **Studio** | Bricolage Grotesque / DM Sans | `#faf6f0` · `#191823` |

Bias axis, per theme: `--left --centre --right` = Newsroom `#2f5c9e #7a746a #a84a2f`, Terminal
`#4b8fe0 #8a99a6 #e8794a`, Studio `#3d6bf5 #8b8698 #e0533d`. Claim axis `--agree --diverge --imply`
= Newsroom `#2d6a4a #a84a2f #5b4a9c`, Terminal `#2fc48d #ff6f4d #b78cff`, Studio
`#12a06c #e0533d #6b4ef0`.

**Signed-out surfaces** (login, register, `/status`) wear Newsroom light — the most neutral of the
three and the system's own voice.

### 1.4 Light and dark

Both modes exist for all three themes: **six palettes**. Default follows `prefers-color-scheme`;
a per-account override is stored on `User` and applied as a class on `<html>`.

**Dark keeps the roles distinct.** Each theme gets its own dark ground — Studio a soft warm
near-black keeping its violet lean, Newsroom a warm charcoal keeping its editorial character,
Terminal as drawn. A shared dark ground would erase role theming exactly when it is demonstrated.

Three of the six palettes came from the design canvas; light-Newsroom, dark-Studio and
light-Terminal are derived from them — same hues, inverted lightness ladder, contrast re-verified
to WCAG AA.

### 1.5 The sign-in transition

On successful login the page paints in signed-out Newsroom, then **a single sweep retints the
tokens** — rules, then washes, then accents — over ~700ms, with the wordmark as the only fixed
element, resolving onto a dashboard whose data has been loading underneath throughout.

The token change *is* the animation. No spinner, no logo bounce, no particles, no gradient shimmer.
Constraints: once per login only, never on subsequent navigation; `prefers-reduced-motion` collapses
it to an instant swap; it never gates first paint or adds perceived latency.

### 1.6 Libraries and craft

Only Express / PostgreSQL / TypeORM / React / JWT are fixed by the course. Everything above that is
open: **Phosphor Icons** throughout (already the canvas's choice), a real charting library, a real
graph library, a real animation library. Nothing is hand-rolled that a library does properly.

`impeccable` runs before any route, component or stylesheet is touched.

---

## 2. Flashcards — rebuild

Today a flashcard *is* an `AnalysisClaim` with a generated question in front of it: no answer
column, born only from a completed analysis, and — the defect — **unlistable**. `GET /flashcards`
returns due cards only, capped at 20; `loadRunDeck` lists a full deck and no route calls it. After
one review a card vanishes from every surface until its `dueAt`.

**New shape.** A student types a search; the top N matching Articles freeze into an EvidenceSet; the
model writes cards **cited to it**. A card owns its own question, answer and citations.

- Corpus is **accepted Story membership only** — the same set `/search` already returns. The
  firehose stays invisible; a student is never taught from unreviewed reporting.
- Options at generation: **card count** (5 / 10 / 20) and **answer length** (one word / one line /
  full). Both are generation parameters, not new machinery.
- The existing invariant holds: no displayed claim without a valid citation. Cards keep citations.
- **Full CRUD**: list every card (not just due), open one, edit its question or answer, delete it.
  Today none of this exists, which is why a failed question-writer's fallback text is permanent.
- SM-2 scheduling is kept as built. `flashcard_reviews` is currently write-only; surface it as
  simple study history.
- Generation from a completed analysis stays as a second entry point.
- **Flashcards** becomes a top-level nav item with an icon. It has none today, which is why it
  could not be found.
- The study surface is the most playful screen in the app: one card, reveal, four grades, keyboard
  driven.

## 3. Bias — spectrum and blindspots

`Publisher` carries no stance today; the one classification axis is rights, not politics.

- Add a **leaning** rating to `Publisher`, sourced from **AllSides** (CC BY-NC 4.0 — free for
  non-commercial use with attribution). The attribution is displayed wherever a rating is.
- **Coverage spectrum** on Story detail and in story lists: this Story's reporting distributed
  left / centre / right, using `--left --centre --right`.
- **Blindspot** signal when coverage is overwhelmingly one-sided. It must be impossible to miss.
- A rating is a **cited claim about a publisher**, displayed with its source — never model-inferred.
  This is what reconciles the feature with the retired design system's objection to implying bias.
- On a fresh `npm run seed` the corpus is fictional, so ratings resolve only after live ingestion
  (§9).

## 4. Market intelligence — investor

- **`createMarketProvider`** seam with a `MockMarketProvider` beside it, following the existing
  `createEmbeddingProvider` / `createSynthesisProvider` pattern (ADR-0003). The demo runs offline
  with no key; the same code path runs live.
- **Finnhub** as the real provider (60 calls/min free, real-time US quotes), model and endpoint from
  env. **Superseded by ADR-0036 — the provider is Tiingo.** Finnhub's free tier answers
  `/stock/candle` with a 403, so it cannot supply the price series the next bullet requires; Tiingo
  serves both the quote and an adjusted daily series on one key. An ADR overrides the spec.
- **Join**: `Entity` gains a `ticker`. `runEntityResolution` already resolves organisations out of
  the firehose, so a Story's market panel appears when its resolved organisations carry tickers and
  degrades honestly to nothing when they do not.
- **Indicators are computed in-house** from a price series — SMA, RSI, volatility — as pure
  functions with unit tests. No API calls, deterministic, and defensible in a viva.
- **A generated read** synthesises what the reporting and the indicators show. It never advises:
  *"trading 4.4% above its 50-day average while six outlets report the licence change"* is
  intelligence; *"consider accumulating"* is advice. `prohibited_investor_language` in
  `backend/src/generation/validate.ts` governs this surface exactly as it governs analysis, and
  §31's deferral of trading recommendations stands.
- Quotes are cached in Redis (§8).

## 5. Role-conditional panels inside the Story

The same Story page is three products. Each role's panel is visible only to that role and enforced
at the API, not just hidden in the UI.

- **Student** — make flashcards from this Story; add to a collection.
- **Investor** — ticker, price chart, indicators, the generated read, add to watchlist.
- **Admin** — which clustering run assembled this Story, which prompt version wrote the analysis,
  inline merge / unmerge.

This is also the strongest available answer to the course's "roles must be visibly distinct"
requirement: the *same page* is demonstrably three pages.

## 6. Reader surfaces

**Investor watchlist** — a new owned entity plus endpoints. The dashboard leads with movement on
what the investor follows. Today the investor dashboard has *zero* per-user state, which is why it
reads as thin next to the student's.

**Briefs**
- Attach an analysis to an **existing** Brief. Today only `POST /briefs` accepts a
  `generationRunId`; `PATCH` silently ignores it, so a Brief's analysis is fixed at creation forever.
- Attach an Article **by searching for it**. Today `BriefDetail.tsx` asks the reader to paste a
  UUID, with copy telling them to go find one. The code's own `ponytail:` comment names this as the
  known gap.

**Analysis caching — a UI defect, not a backend one.** Server-side reuse works and is tested
(`reused: true`, no model call). But there is no `GET` for a Story's existing analysis, and the
frontend holds the result in `useMutation` state, which is outside the query cache. So every visit
shows "Request analysis" again and `reused` is never rendered anywhere. Add the read endpoint, cache
it, and say plainly when an analysis was reused rather than regenerated.

**Timeline** — `/search/timeline` already does what was asked: search a keyword, get one lane per
Story. It is not in the nav, so nobody finds it. Promote it to a top-level destination with a proper
landing state, and make the volume bars clickable through to their articles (they are inert `<i>`
elements inside a `role="img"` today).

**Knowledge graph** — Cytoscape already renders it and zoom/pan already work. It is configured
`autoungrabify: true, autounselectify: true, animate: false` with no hover state and no tooltip.
Make it properly interactive: hover highlighting, neighbour emphasis, tooltips, visible zoom
controls, animated layout. Bound the "names in the graph" register in a scroll container.

**No Neo4j** (ADR-0019 stands). At 60 nodes and depth 1 it changes nothing about rendering, which is
the entire complaint.

## 7. Admin console

- **User management** — none exists at the API: `auth.ts` has exactly register, login and me. Add
  list, detail, role change, and **soft deactivate**. No hard delete: deleting a user cascades away
  their Briefs and flashcards.
- **Connector CRUD** — `PATCH /ingestion/connectors/:id` accepts one field, `enabled`. Add create,
  edit and delete.
- **Fix the truncating review queues.** Both the clustering-review and entity-merge registers print
  the true total ("31 awaiting a decision") and render the API's default page of 10, with no
  pagination control. That reads as lost data.
- **Bound every register.** The only `overflow-y: auto` in 968 lines of CSS belongs to the deleted
  prototype. Every dashboard, admin register, graph list and timeline lane grows the page without
  limit today — this is the reported lag.

## 8. System design

Not new architecture — the gaps in what exists.

- **Architecture document with diagrams**: request lifecycle, the async pipeline, the data model,
  the caching layers. This is the artefact to present; the architecture itself is already there
  (queue-based workers, idempotent ingestion, content-hash caching, in-flight coalescing, immutable
  frozen evidence, `SELECT … FOR UPDATE`, `REPEATABLE READ` snapshots, read/write path separation,
  ports and adapters, hybrid RRF retrieval).
- **Redis as a cache.** It is currently a queue backend only. Point it at the measured hot path:
  `comparableStories()` runs full evidence selection up to ten times per investor dashboard load and
  already carries a `ponytail:` note saying so. Market quotes cache here too.
- **Structured logging with request IDs** — spec §22.1, never built; today it is bare `console.log`.
- **Rate limiting** on auth and the expensive generation endpoints. None exists.

## 9. Rights model relaxation

This is a course project, not a business. No decision optimises for commercial rights.

- Seeded and ingested publishers default to `licensed`; **`api_content` becomes servable**.
- `terms_class`, `mayServeText` and `mayStoreText` **stay** as modelled concepts — they are spec §8
  and they earn marks. The *policy* changes, not the architecture.
- What this unlocks: readable article text on Article detail, **real excerpts on citations** (today
  `runGeneration.ts:478` nulls them for most publishers, so "says who?" opens onto nothing), and
  more stored text for embeddings and clustering.

**Demo corpus stays fictional** (user's decision). Bias ratings and market panels therefore populate
only after live GDELT ingestion, so the demo runbook opens with *run the worker and let ingestion
land* — not `npm run seed` alone.

## 10. Naming and copy

One pass, landing against `CONTEXT.md` so the glossary and the screens agree.

| Now | Becomes |
|---|---|
| Study collections | My Briefs |
| Flashcard reviews | Flashcards |
| Comparable coverage | Ready to analyse |
| Study desk | Your desk |
| register / folio / plate | plain words |

"Ready to analyse" says what the list is *for* rather than what it is made of. The Bureau vocabulary
goes with the Bureau aesthetic.

## 11. ADRs this phase must write

1. **Bureau retired; role-based theming adopted.** Supersedes `DESIGN.md`'s north star. Why: a
   prohibition-only system shipped an unusable interface; theme-by-role turns one product into three
   without duplicating components, because all themes share one token contract.
2. **Publisher leaning from AllSides (CC BY-NC).** Why: a sourced third-party rating is a cited
   claim, not an implication — consistent with the citation invariant. Records the commercial-licence
   boundary as a future requirement.
3. **Market data provider seam; intelligence without advice.** Why: reuses ADR-0003's provider
   pattern; draws the line `validate.ts` already enforces, keeping §31's deferral of trading
   recommendations intact.
4. **Flashcards regrounded on search-frozen evidence.** Why: keeps the citation invariant while
   changing the entry point; a card now owns its answer.
5. **Rights policy relaxed for a non-commercial build.** Supersedes the serving policy in ADR-0018 /
   ADR-0024 without removing the model.
6. **Provider selection on access and cost** — supersedes ADR-0003's "paid, contractually
   no-training provider only", which the running `.env` already contradicts.

## 12. Out of scope

Neo4j · the eval harness (Phase 4, after this) · the Dossier and Field design directions (Field
returns if a mobile app happens) · user-chosen role themes · trading recommendations · everything in
spec §31's deferral list.

## 13. Verification

- `npm test` (backend, Testcontainers Postgres) and `npm test` + `npm run build` (frontend) green.
- New pure logic — SM-2 already, plus the indicator functions — covered by unit tests.
- Every reworked route demonstrates its four UI states.
- Contrast checked to WCAG AA across **all six** palettes; keyboard paths verified; the sign-in
  transition verified under `prefers-reduced-motion`.
- Screenshots of every route in all three themes, light and dark, into
  `docs/verification/phase-3.6/`, replacing the bureau-rollout set as the current evidence.
- Phase 3.5's own exit criterion is closed out first: a graph and a timeline actually rendering for
  seeded Stories, since that was never verified before this phase began.
- The demo runbook (spec §28.1) rehearsed end to end from a clean deploy.
