# AGENTS.md

**Tessera** — evidence-grounded news intelligence workspace. Course capstone
(Node/Express/TypeORM/PostgreSQL/React, JWT+RBAC) that is also the foundation of a real product.

## Quick start

1. Read `CONTEXT.md` for the domain glossary — use these exact terms.
2. Read `docs/adr/` (23 ADRs) — **these override the spec** where they conflict.
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
Ingestion, the flagship generation pipeline, and Phase 3.5 (graph/timeline) are not built yet.
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
`/status` are stated pages in the same vocabulary, screenshots at both breakpoints sit in
`docs/verification/bureau-rollout/`. `/` redirects to
the caller's own dashboard. The
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
- GDELT/API **metadata** is storable; article **bodies** are internal only, never redistributed.
  One documented exception: the hosted embedding provider (ADR-0023). Synthesis evidence text
  goes only to the paid, contractually no-training provider (ADR-0003).

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
npm run build     # tsc -> dist/
npm run migrate   # apply TypeORM migrations
npm run seed      # demo users for all three roles (only path to an Admin, ADR-0015) + the
                  # Story/Article/Publisher corpus + one owned Brief with a cover image;
                  # embedded with the hosted provider when GEMINI_API_KEY is set, else the
                  # Mock (ADR-0023 — switching providers needs a fresh volume, see SETUP.md)
npm test          # vitest; spins up an ephemeral Postgres via Testcontainers, needs docker access
```

No lint script exists yet. Do not claim it passes until implemented.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
