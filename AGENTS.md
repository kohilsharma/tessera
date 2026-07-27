# AGENTS.md

**Tessera** — evidence-grounded news intelligence workspace. Course capstone
(Node/Express/TypeORM/PostgreSQL/React, JWT+RBAC) that is also the foundation of a real product.

## Quick start

1. Read `CONTEXT.md` for the domain glossary — use these exact terms.
2. Read `docs/adr/` (22 ADRs) — **these override the spec** where they conflict.
3. Read `project-docs/Tessera_Master_Build_Specification_v3.md` — the full product spec.
4. Read `project-docs/project-statement.md` — non-negotiable course requirements.
5. Read `project-docs/Tessera_Initial_Report.md` — the capstone initial report (submission-ready).

> `project-docs/ai-news-intelligence-spec.md` is a **superseded early draft** (Python/FastAPI/
> Kafka/Neo4j/Next.js-SSR). Do NOT build from it. See ADR-0005.

## Repo state

**Backend/** — empty. To be built: Node/Express + TypeORM + PostgreSQL.
**Frontend/** — empty. To be built: Vite + React SPA.

No package.json, no source files, no tests, no migrations exist yet.

## Stack (decided — do NOT scaffold the old spec's stack)

| Layer | Tech | ADR |
|---|---|---|
| Backend | Node/Express + TypeORM + PostgreSQL (+pgvector) | 0005 |
| Queue/worker | Redis + BullMQ | 0005 |
| Graph | Plain Postgres tables + recursive CTEs (NO Neo4j) | 0019 |
| Embeddings | bge-m3 via TEI (Docker) @ `vector(1024)` | 0017 |
| Ingestion | GDELT GKG 15-min firehose + DOC API + RSS + Readability | 0018 |
| Frontend | Vite + React SPA; Cytoscape.js for graph view | 0005, 0019 |
| LLM | Cheap OpenAI-compatible models via env config + Mock provider | 0003 |
| Local demo | Docker Compose (Postgres+pgvector, Redis, TEI); app runs natively | 0015 |

**NO:** Kafka, Python/FastAPI, SSR, Neo4j, separate vector DB, hardcoded model IDs.

## Locked decisions (see docs/adr/ for full rationale)

- **ADR-0001** Course-first scope, startup-shaped architecture.
- **ADR-0002** Flagship = frozen-evidence cited synthesis.
- **ADR-0003** Cheap OpenAI-compatible models via env config + validate-and-repair loop. No hardcoded model IDs. Mock provider required.
- **ADR-0004** Three genuinely distinct roles (Admin/Student/Investor) — different endpoints & data.
- **ADR-0005** Node/Express + TypeORM + PostgreSQL backend; Vite + React SPA; Redis + BullMQ; NO SSR; NO Python.
- **ADR-0017** Embeddings: bge-m3 via TEI @ vector(1024); voyage/gemini API fallbacks.
- **ADR-0018** Ingestion: GDELT GKG firehose + DOC API + RSS + Readability. Metadata open; bodies internal-only.
- **ADR-0019** Knowledge graph: GKG-backed, bounded (~50–200 nodes), co-occurrence edges in plain Postgres. No Neo4j. Typed relations deferred.
- **ADR-0020** Timeline: read view over Stories (evolution only, not alerting).
- **ADR-0021** Role features: Student flashcards, Admin PromptTemplate tuning, Investor consensus/contradiction.
- **ADR-0022** Build order: Foundation → Ingestion → Flagship → Phase 3.5 (graph+timeline) → Eval.

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

Full list: 31 skills in `.agents/skills/` — see `ask-matt` if unsure which fits.

## Plugins

| Plugin | Purpose |
|---|---|
| **caveman** | Ultra-compressed output mode (65% token savings) |
| **rtk** | Auto-rewrites shell commands through `rtk rewrite` for token savings |
| **ponytail** | Lazy senior dev mode — forces simplest working solution |

## Available MCPs

| MCP | Type | Purpose |
|---|---|---|
| **serena** | local (uvx) | Language server: symbol navigation, find references, project indexing |
| **context7** | local (npx) | Up-to-date library documentation for frameworks/SDKs |
| **exa** | remote | Web search and page fetch via exa.ai |

## Verification

No manifests or test framework exist yet. When they do, document the exact `npm` invocations
here (build / dev / lint / test). Do not claim a build passes until a real command exists.

## RTK (token-optimized commands)

Always prefix shell commands with `rtk` for 60-90% token savings:

```bash
rtk git status          rtk git diff            rtk git log
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk pytest tests/       rtk npm run <script>    rtk docker ps
rtk tsc                 rtk lint                rtk prettier --check
```

Prefix each segment in chains: `rtk git add . && rtk git commit -m "msg"`.
For debugging, use raw command without rtk prefix.
