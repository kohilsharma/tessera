# AGENTS.md

**Tessera** — evidence-grounded news intelligence workspace. Course capstone
(Node/Express/TypeORM/PostgreSQL/React, JWT+RBAC) that is also the foundation of a real product.

## Read before you build

Each pointer names the branch that reaches it. Read what your task hits.

| Read | When |
|---|---|
| `CONTEXT.md` | Always — the domain glossary. Use these exact terms. |
| `docs/adr/` (29 ADRs) | Touching a decided area. **ADRs override the spec.** |
| `docs/repo-state.md` | Extending a shipped module — the per-ticket narrative and the measurements behind the table below. |
| `project-docs/Tessera_Master_Build_Specification_v3.md` | Building something unbuilt, at §-level detail. |
| `project-docs/project-statement.md` | Checking a course requirement. |
| `project-docs/Tessera_Initial_Report.md` | Writing submission prose. |

## Repo state

Phases 1 and 2 are complete; Phase 3 through #58; Phase 3.5 in flight — entity resolution (#66),
a Story's timeline (#64), the search timeline (#65), candidate merges (#67), the bounded global
graph (#68) and one Entity's neighbourhood (#69) are in; the Extraction pass (#70) is ahead.
`docs/repo-state.md` carries the per-ticket detail.

**backend/** — one seam per module. Extend the seam rather than adding a parallel path.

| Module | Seam | Ships |
|---|---|---|
| `src/ingestion/` | `runConnector` | RSS, GKG 15-min firehose, DOC, Readability. Canonical-URL identity, dedup, cross-connector enrichment, Terms-Class rights checks, window cursor + 7-day GDELT retention, GKG Annotation staging |
| `src/clustering/` | `runClustering` | Embed → centroid → nearest-Story assignment. No singleton Stories, model-named new Stories, a pending-review band beneath the threshold, Story merge |
| `src/generation/` | `runGeneration` | Deterministic evidence selection → frozen EvidenceSet (`A1…` ids, SHA-256) → cited claims under one Lens. Validation below the prompt, repair ×2, Admin-tunable `prompt_templates` |
| `src/graph/` | `runEntityResolution`, `loadGraphView` | Normalized-name folding, promotion floor, rolling co-occurrence graph, edges bounded from both ends, trigram merge candidates above a bar and a review band beneath it, merges and refusals remembered by name, whole pass in one transaction. One read seam for both pictures — the whole graph and one Entity's neighbourhood one hop out, with the reporting under any edge openable — bounded again for one screen, not for storage. `GET /graph` takes no parameters, and the only thing a neighbourhood takes is a Theme, which only ever narrows |
| `src/timeline/` | `buildTimeline` | Takes a **set of Articles**, never a query. Reporting and analytical events on one axis, granularity chosen from the span, one lane per Story over a set drawn from many |
| `src/lib/storyMembership.ts` | — | The one accepted-membership predicate every reader surface tests |

Worker: `src/worker.ts` is its own process (natively, not in Compose — ADR-0015) draining three
BullMQ queues — ingestion on the quarter hour, clustering at :05, graph resolution at :20. Every
Admin trigger enqueues and answers `202 {status:"accepted"}`, so there is one execution path; run
history reads from Postgres, never the queue, so the consoles render with the worker stopped.

**frontend/** — `src/App.tsx` is the route table alone, chrome comes from
`components/AppShell.tsx`, and `src/api/client.ts` is the one `fetch` layer. The **Bureau**
rollout (#28–#37) is complete across all four archetypes — Index, Record, Form, Dashboard — with
screenshots at both breakpoints in `docs/verification/bureau-rollout/`. Every route covers the
four shared UI states, and states "nothing here" differently from a failed request.

Shared registers, reused rather than redrawn per page: `components/timelineRegister.tsx` (Story
detail's coverage register, and the axis and bars every `/search/timeline` lane draws),
`components/graphRegister.tsx` (the kind marks, the Cytoscape mapping, the plot and its legend, drawn
by `/graph` and by every Entity's neighbourhood) and
`components/analysisRegister.tsx` (claims, read differently under
each Lens, on both Story detail and Brief detail). The Admin console's six Phase-3 registers
live in `pages/adminRegisters.tsx`, each owning its own request and commands, laid out by
`pages/AdminDashboard.tsx`. `src/versions/BureauPrototype.tsx` at `/design-prototype` sits
outside the app path.

## Stack (decided)

| Layer | Tech | ADR |
|---|---|---|
| Backend | Node/Express + TypeORM + PostgreSQL (+pgvector) | 0005 |
| Queue/worker | Redis + BullMQ | 0005 |
| Graph | Plain Postgres tables + recursive CTEs | 0019 |
| Embeddings | Hosted API @ `vector(1024)`; TEI/bge-m3 optional local | 0017, 0023 |
| Ingestion | GDELT GKG firehose + DOC API + RSS + Readability | 0018 |
| Frontend | Vite + React SPA; Cytoscape.js for the graph view | 0005, 0019 |
| LLM | Cheap OpenAI-compatible models via env config + Mock provider | 0003 |
| Local demo | Docker Compose (Postgres+pgvector, Redis); app runs natively | 0015, 0023 |

Reach for the row above rather than the ecosystem default: Postgres tables carry the graph, BullMQ
carries the queue, and the model ID always comes from env.

## Locked decisions

One line each, so a decided area is never re-litigated by accident. Full rationale in
`docs/adr/`; the ADR wins wherever it and the spec conflict.

- **0001** Course-first scope, startup-shaped architecture.
- **0002** Flagship = frozen-evidence cited synthesis.
- **0003** Cheap OpenAI-compatible models via env config + validate-and-repair. Mock provider required.
- **0004** Three genuinely distinct roles (Admin/Student/Investor) — different endpoints and data.
- **0005** Node/Express + TypeORM + PostgreSQL; Vite + React SPA; Redis + BullMQ.
- **0015** The seed is the only path to an Admin; the app runs natively beside Compose.
- **0017** Embeddings @ `vector(1024)`, HNSW cosine, swappable within the 1024 Matryoshka family.
- **0018** Ingestion: GKG firehose + DOC + RSS + Readability. Metadata open, bodies internal-only.
- **0019** Knowledge graph: GKG-backed, bounded (~50–200 nodes), co-occurrence edges in Postgres. Typed relations deferred.
- **0020** Timeline: a read view over Stories — evolution, not alerting.
- **0021** Role features: Student flashcards, Admin PromptTemplate tuning, Investor consensus/contradiction.
- **0022** Build order: Foundation → Ingestion → Flagship → Phase 3.5 (graph + timeline) → Eval.
- **0023** Embeddings served by a hosted API (the demo machine has ~3 GB free RAM); TEI optional.
- **0024** Analysis Text Mode is an ordered ladder (`metadata_only` < `feed_excerpt` < `api_content` < `licensed_full_text`); modes only move up. One canonical URL across connectors is *enrichment*, not duplication.
- **0025** Embeddings and synthesis share one OpenAI-compatible retry transport; query/passage marking is load-bearing; rate limits count requests, so batch.
- **0026** Clustering: one similarity knob with time as a hard gate, no singleton Stories, membership on `articles`, centroid recomputed per run, Curated Corpus closed both ways.
- **0027** Generation: deterministic evidence selection, partial claim acceptance with a floor, repair rather than a model-escalation ladder, one Lens per GenerationRun.
- **0028** The graph is firehose-derived and rolling, not Story-scoped. Themes are never nodes.
- **0029** The Curated Corpus is closed to clustering, open to entity resolution.

## Core invariants (must survive refactors)

- **No displayed claim without a valid citation** into its generation's frozen EvidenceSet —
  enforced in backend code, below the prompt, non-tunable.
- Every **EntityEdge** carries its source Article; an uncited edge is a bug. One row per (pair,
  Article) with `ON DELETE CASCADE`, so weight is a count at read time.
- Entity resolution uses a **confidence threshold**; borderline merges queue for Admin review.
  A merge and a refusal are both remembered **by normalized name**, never by Entity id: a pass
  re-promotes every name above the floor hourly, so an id-keyed decision is undone within the hour.
- EntityEdges are **co-occurrence**, not typed relations.
- Cache LLM calls by content hash; batch where possible.
- Every public read path joins through accepted Story membership
  (`backend/src/lib/storyMembership.ts`), so the firehose stays invisible to readers by construction.
  One documented exception: `GET /graph` reads the retained firehose deliberately (ADR-0028 — a
  Story-scoped graph is permanently empty), and pays for it by stating its corpus on screen. Any
  *other* reader path that skips the join is a bug.
- GDELT/API **metadata** is storable; article **bodies** are internal, served only where a
  Publisher's Terms Class clears them by hand — never for `api_content`, which Tessera extracted
  itself. Two documented exceptions: the hosted embedding provider (ADR-0023), and synthesis
  evidence text, which goes only to the paid, contractually no-training provider (ADR-0003).

## Verification

`npm run` lists the scripts. These are the parts the scripts do not confess.

Backend (`backend/`, after `docker compose up -d` — see `SETUP.md`):

- `npm test` needs docker access (ephemeral Postgres via Testcontainers). No Redis in the test
  stack, so the enqueue is stubbed.
- `GDELT_LIVE_SMOKE=1` adds the three live GDELT checks and serializes test files, since two of
  them pace against one rate-limited endpoint. `SYNTHESIS_LIVE_SMOKE=1` adds the one live
  synthesis check and reads `SYNTHESIS_*` from `backend/.env` by hand — `vitest.config.ts` pins
  those keys empty so nothing else can reach a provider by accident.
- `npm run worker` needs `REDIS_URL` and its own terminal.
- `npm run seed` is the only path to an Admin (ADR-0015). Switching embedding providers needs a
  fresh volume — see `SETUP.md`.

Frontend (`frontend/`): `npm run build`, and `npm test` (vitest + jsdom + React Testing Library)
over the list/search views, the Brief form, and the auth flow.

No lint script exists in either package. Do not claim lint passes until one does.

## Working conventions

- Follow ADR-0022's exit criteria; don't jump a phase ahead.
- Add the verification command here whenever you introduce a `package.json`, `Dockerfile`, or CI.
- Issue tracker: GitHub Issues on `kohilsharma/tessera` via `gh`. See `docs/agents/issue-tracker.md`
  for conventions and `docs/agents/triage-labels.md` for the five-role label vocabulary.
- Domain language is single-context: `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Agent skills

Load with the `skill` tool. `find-skills` locates one when none below fits; `ask-matt` maps how
they fit together. Skills are pinned in `skills-lock.json` (`.agents/` and `.claude/` are
gitignored) — restore with `npx skills experimental_install`, refresh with `npx skills update -p`.

| Skill | Use when |
|---|---|
| `hallmark` | Building, redesigning, or auditing a page or component |
| `tdd` | Writing tests for a feature or fix |
| `implement` | Implementing from a spec or a ticket |
| `diagnosing-bugs` | Something is broken, throwing, or flaking |
| `code-review` | Reviewing changes since a commit or branch |
| `grilling` | Stress-testing a plan or design |
| `to-spec` / `to-tickets` | Turning a thread into a spec, then into tracer-bullet tickets |
| `research` | Delegating reading legwork to a background agent |
| `domain-modeling` | Sharpening a domain term |
| `codebase-design` | Finding deepening opportunities in a module |
| `caveman-commit` | Every commit message |

**ponytail** (plugin) runs lazy-senior-dev mode by default: simplest working solution.

Browser work: `agent-browser open <url>` → `agent-browser snapshot -i` for refs (`@e1`) →
`click`/`fill` against the refs, re-snapshotting after the page changes. `--help` for the rest.
