# AGENTS.md

**Tessera** — evidence-grounded news intelligence workspace. Course capstone
(Node/Express/TypeORM/PostgreSQL/React, JWT+RBAC) that is also the foundation of a real product.

## Read before you build

Each pointer names the branch that reaches it. Read what your task hits.

| Read | When |
|---|---|
| `CONTEXT.md` | Always — the domain glossary. Use these exact terms; `docs/agents/domain.md` says why. |
| `docs/adr/` — the filenames are the index, so `ls` it | Touching a decided area. **An ADR overrides the spec**, and a decided area is never re-litigated by accident. |
| `docs/Tessera Directions.html` | The design canvas export — the primary source `DESIGN.md` was written from. Mine it with `grep`; it is 9.8 MB and must never be read whole. |
| `DESIGN.md` | **Any** frontend work — the token contract, the six role palettes, the four states, the component rules. |
| `docs/phase-3.6-spec.md` | Working a Phase 3.6 ticket (epic #71) — the whole agreed scope, in build order. |
| `docs/repo-state.md` — an index; read only the **phase file** you are touching | Extending a shipped module — the per-ticket narrative and the measurements behind it. The whole history is ~14k tokens; one phase is a fraction of that. |
| `project-docs/Tessera_Master_Build_Specification_v3.md` | Building something unbuilt, at §-level detail. |
| `project-docs/project-statement.md` | Checking a course requirement. |
| `project-docs/Tessera_Initial_Report.md` | Writing submission prose. |
| `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md` | Working an issue — GitHub Issues on `kohilsharma/tessera` via `gh`. |

## Repo state

Phases 1 through 3.5 are complete: #72 verified Phase 3.5's ADR-0022 exit criterion against a live
corpus, with the screenshots in `docs/verification/phase-3.5/`. **Phase 3.6** (epic #71, scope in
`docs/phase-3.6-spec.md`) is the current phase, and the eval harness now runs after it rather than
before. Don't jump a phase ahead.

**backend/** — one seam per module. Extend the seam rather than adding a parallel path.

| Module | Seam | The rule the seam keeps |
|---|---|---|
| `src/ingestion/` | `runConnector` | RSS, the GKG 15-minute firehose, DOC and Readability all behind one path. Canonical-URL identity, so a second connector's sighting is *enrichment* and never a second Article |
| `src/clustering/` | `runClustering` | Embed → centroid → nearest Story. No singleton Stories, and a pending-review band beneath the threshold |
| `src/generation/` | `runGeneration` | Deterministic evidence selection → frozen EvidenceSet (`A1…` ids, SHA-256) → cited claims under one Lens |
| `src/graph/` | `runEntityResolution`, `loadGraphView` | One write path, one read path. Both pictures — the whole graph, one Entity's neighbourhood — come from the read seam, bounded for one screen rather than for storage; `GET /graph` takes no parameters, and a Theme only ever narrows |
| `src/timeline/` | `buildTimeline` | Takes a **set of Articles**, never a query |
| `src/lib/storyMembership.ts` | — | The one accepted-membership predicate every reader surface tests |

`src/worker.ts` is its own process (natively, not in Compose — ADR-0015) draining three BullMQ
queues: ingestion on the quarter hour, clustering at :05, graph resolution at :20. Every Admin
trigger enqueues and answers `202 {status:"accepted"}`, so there is one execution path; run history
reads from Postgres, never the queue, so a console renders with the worker stopped.

**frontend/** — `App.tsx` is the route table alone, `components/AppShell.tsx` carries the chrome,
`api/client.ts` is the one `fetch` layer. The **Bureau** rollout (#28–#37) is complete across its
four archetypes — Index, Record, Form, Dashboard — with screenshots at both breakpoints in
`docs/verification/bureau-rollout/`. Every route covers the four shared UI states, and says
"nothing here" differently from a failed request. What two pages both draw lives in a shared
register beside the thing it draws, reused rather than redrawn per page.
`src/versions/BureauPrototype.tsx` at `/design-prototype` sits outside the app path — changing it
changes no route a reader reaches.

## Reach for the decided stack

Against the ecosystem default: Postgres tables and recursive CTEs carry the graph (ADR-0019 — no
graph database), BullMQ carries the queue (0005), embeddings are a hosted API at `vector(1024)`
(0017, 0023), and the model ID always comes from env, against an OpenAI-compatible host with a Mock
provider beside it (0003). Compose runs Postgres and Redis; the app runs natively (0015).

**The course mandates the base; everything above it is open.** Express, PostgreSQL, TypeORM, React
and JWT are fixed. Nothing else is forbidden, so reach for a component, chart, icon or graph
library rather than hand-rolling one — hand-rolled CSS bars and an icon-free UI are what the
frontend is being rebuilt away from. This is a course project, not a business: free tiers and
non-commercial licences are fine, and no decision here optimises for commercial rights.

**Frontend work runs through the `impeccable` skill.** Invoke it before touching a route,
component or stylesheet. It is what keeps the interface from reading as AI slop, which is the
failure the whole redesign exists to correct.

## Finishing a ticket

A ticket is not done when the code works. Before it closes:

1. **Append its narrative to its phase's file under `docs/repo-state/`** — what shipped, the decisions inside it, and
   any measurement taken. That file is how the *next* session, in a fresh window, learns what
   already exists; a ticket that leaves nothing there is invisible an hour later.
2. **Tick its box in the epic** so the phase's remaining work reads at a glance.
3. **Write the ADR** if the ticket names one. The reasoning dies with the session otherwise.

## Core invariants (must survive refactors)

- **No displayed claim without a valid citation** into its generation's frozen EvidenceSet —
  enforced in backend code, below the prompt, non-tunable.
- Every **EntityEdge** carries its source Article; an uncited edge is a bug. One row per (pair,
  Article) with `ON DELETE CASCADE`, so weight is a count at read time. Edges are
  **co-occurrence**, not typed relations.
- Entity resolution uses a **confidence threshold**; borderline merges queue for Admin review. A
  merge and a refusal are both remembered **by normalized name**, never by Entity id: a pass
  re-promotes every name above the floor hourly, so an id-keyed decision is undone within the hour.
- Cache LLM calls by content hash; batch where possible.
- Every public read path joins through accepted Story membership
  (`backend/src/lib/storyMembership.ts`), so the firehose stays invisible to readers by
  construction. One documented exception, and it is a seam rather than a route: everything behind
  `loadGraphView.ts` reads the retained firehose deliberately (ADR-0028 — a Story-scoped graph is
  permanently empty), and pays for it by stating that corpus on screen wherever it is drawn.
  Membership still runs there, but only to *label* a citation, never to filter one: it is what
  decides whether a graph citation can offer a Story or an Article record at all. A reader path
  outside that seam which skips the join is a bug.
- GDELT/API **metadata** is storable; article **bodies** are internal, served only where a
  Publisher's Terms Class clears them by hand — never for `api_content`, which Tessera extracted
  itself. Two documented exceptions: the hosted embedding provider (ADR-0023), and synthesis
  evidence text, which goes only to the paid, contractually no-training provider (ADR-0003).

## Verification

`npm run` lists the scripts. These are the parts the scripts do not confess. Add a line here
whenever you introduce a `package.json`, `Dockerfile`, or CI.

Backend (`backend/`, after `docker compose up -d` — see `SETUP.md`):

- `npm test` needs docker access (ephemeral Postgres via Testcontainers). No Redis in the test
  stack, so the enqueue is stubbed.
- `GDELT_LIVE_SMOKE=1` adds the three live GDELT checks and serializes test files, since two of
  them pace against one rate-limited endpoint. `SYNTHESIS_LIVE_SMOKE=1` adds the one live synthesis
  check and reads `SYNTHESIS_*` from `backend/.env` by hand — `vitest.config.ts` pins those keys
  empty so nothing else can reach a provider by accident.
- `EXTRACTION_LIVE_SMOKE=1` adds the seven live extraction checks — one page-fetch per
  extraction-eligible seeded feed, plus one whole run — and takes ~60s, since it paces itself at one
  request per publisher per 2 seconds. Run it after touching the page transport: an injected
  `fetchPage` cannot tell you the real one works (#70).
- `npm run worker` needs `REDIS_URL` and its own terminal.
- `npm run seed` is the only path to an Admin (ADR-0015). Switching embedding providers needs a
  fresh volume — see `SETUP.md`.

Frontend (`frontend/`): `npm run build`, and `npm test` (vitest + jsdom + React Testing Library).

No lint script exists in either package. Say lint passes only once one does.

## Skills

Pinned in `skills-lock.json` (`.agents/` and `.claude/` are gitignored) — restore with
`npx skills experimental_install`, refresh with `npx skills update -p`. `find-skills` locates one
when nothing loaded fits.
