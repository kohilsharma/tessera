# AGENTS.md

This repo is **Tessera**: an evidence-grounded news intelligence workspace, built as a
course capstone (Node/Express/TypeORM/PostgreSQL/React, JWT+RBAC) that is also the foundation
of a real product.

## Authoritative docs (read in this order)

1. `project-docs/Tessera_Master_Build_Specification_v3.md` — the product/architecture spec.
2. `docs/adr/` — **binding decisions that override the spec where they conflict.** Read these first.
3. `CONTEXT.md` — the domain glossary (ubiquitous language). Use these exact terms.
4. `project-docs/project-statement.md` — the non-negotiable course requirements.

> `project-docs/ai-news-intelligence-spec.md` is a **superseded early draft** (Python/FastAPI/
> Kafka/Neo4j/Next.js-SSR). Do NOT build from it. It is kept only for history. See ADR-0005.

## Locked decisions (see docs/adr/ for full rationale)

- **ADR-0001** Course-first *scope*, startup-shaped *architecture*. Every graded feature must
  finish end-to-end; startup-only modules are deferred *behind interfaces*, not designed out.
- **ADR-0002** Flagship = frozen-evidence **cited synthesis**. (Its entity-graph *deferral* is
  superseded by ADR-0019 — the graph is back, GKG-backed and bounded.)
- **ADR-0003** Cheap OpenAI-compatible models via env config + our own validate-and-repair loop.
  No hardcoded model IDs. A deterministic Mock provider must exist (no API key needed for tests).
- **ADR-0004** Three genuinely distinct roles (Admin/Student/Investor) — Student and Investor
  have different endpoints & data, not one lens flag.
- **ADR-0005** **Node/Express + TypeORM + PostgreSQL** backend; **Vite + React SPA** frontend;
  **Redis + BullMQ** (NO Kafka); **NO SSR**; **NO Python** (`backend/.venv` removed).
- **ADR-0006/0007** Full live ingestion built first, timeboxed, with an always-built fixtures fallback.
- **ADR-0017** Embeddings: local **bge-m3 via TEI @ `vector(1024)`**; voyage-3.5-lite /
  gemini-embedding-001 as cheap fallbacks behind the `EmbeddingProvider` interface.
- **ADR-0018** Ingestion = **GDELT GKG 15-min firehose** (free entity/theme substrate) + DOC 2.0
  API + curated RSS + `@mozilla/readability` full-text. Metadata open; bodies internal-only.
- **ADR-0019** Knowledge graph **un-deferred**: GKG-backed, **bounded/curated** (~50–200 nodes),
  entity resolution + Admin review, **co-occurrence edges** in **plain Postgres** (no Neo4j),
  Cytoscape view, **Phase 3.5**. Typed relations deferred.
- **ADR-0020** **Timeline** ships as a read view over Stories (evolution only, not alerting).
- **ADR-0021** Role features on the generation pipeline: Student **flashcards**, Admin
  **PromptTemplate tuning** (never the citation validator), Investor **consensus/contradiction**.
- **ADR-0022** Build order: Foundation → Ingestion → Flagship (+role features) → **Phase 3.5
  graph+timeline** → Eval. Supersedes ADR-0016.

## Repo state

- Backend: to be built in Node/Express (a stale Python `.venv` under `backend/` must be removed).
- Frontend: to be built as a Vite+React SPA. An old Next.js landing page may exist; it is NOT
  the graded app.

## Locked skill: hallmark

`hallmark` is installed under `.agents/skills/hallmark/` and pinned in `skills-lock.json`. Load it via the `skill` tool whenever building/redesigning/auditing a page or component, or when the user asks for a design deliverable. Do not bypass it with generic landing-page patterns.

## Working conventions for this repo

- **ADRs override the spec.** Where v3 and `docs/adr/` conflict, the ADR wins. The v3 spec's
  own stack/phase/SSR sections are historical where an ADR has re-decided them (see below).
- **Phased delivery.** Follow **ADR-0022**: Foundation → Ingestion → Flagship (+ role features)
  → Phase 3.5 (graph + timeline) → Eval. Each phase has an exit criterion; don't jump ahead.
- **Core invariants that must survive refactors:**
  - **No displayed claim without a valid citation** into its generation's frozen EvidenceSet —
    enforced in backend code, below the prompt, non-tunable (ADR-0010, ADR-0021).
  - Every **EntityEdge** carries its `source_article_id` — uncited edges are bugs (ADR-0019).
  - Entity resolution uses a **confidence threshold**; borderline merges queue for Admin review (ADR-0019).
  - EntityEdges are **co-occurrence**, not typed relations (typed relations deferred, ADR-0019).
  - Cache LLM calls by `content_hash`; batch where possible.
- **Licensing default.** GDELT/API **metadata** is storable; article **bodies** are internal
  analysis only, never redistributed. Per-source `terms_class` gates storage (ADR-0018).
- **No SSR.** The app is a **Vite + React SPA** (ADR-0005). The old spec's SEO-SSR public
  surface is *not* built for the graded app.

## Stack (decided — do NOT scaffold the old spec's stack)

Scaffold to the ADRs, not to v3 §10. The correct stack:

- **Backend:** Node/Express + TypeORM + PostgreSQL (+pgvector). **No Python / FastAPI.** (ADR-0005)
- **Queue/worker:** Redis + BullMQ. **No Kafka.** (ADR-0005)
- **Graph:** plain **Postgres** tables + recursive CTEs. **No Neo4j.** (ADR-0019)
- **Embeddings:** **bge-m3 via TEI (Docker) @ `vector(1024)`**; voyage/gemini API fallback. (ADR-0017)
- **Ingestion:** GDELT GKG firehose + DOC API + RSS + `@mozilla/readability`. (ADR-0018)
- **Frontend:** Vite + React SPA; Cytoscape/force-graph for the bounded graph view. (ADR-0005, ADR-0019)
- **LLM:** cheap OpenAI-compatible models via env config + our validate-and-repair loop + Mock provider. (ADR-0003)
- **Local demo:** Docker Compose for stateful deps (Postgres+pgvector, Redis, TEI); app runs
  natively; `npm run seed` loads fixtures. (ADR-0015)

If you introduce `package.json`, a `Dockerfile`, or CI, add the matching verification command below.

## Verification

- No manifests or test framework exist yet. When they do, document the exact `npm` invocations
  here (build / dev / lint / test). Do not claim a build passes until a real command exists and runs.


## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->
