# Tessera — Domain Glossary

The ubiquitous language for this project. Glossary only — no implementation details.
Terms are canonical: use these words in code, docs, and conversation.

## Core artifacts

- **Story** — A persistent cluster of related Articles about one evolving real-world
  event. Shared global knowledge; has no single user owner. Not a user's saved item.

- **Article** — One piece of reporting discovered from a connector. Carries the text
  actually available for analysis (see *Analysis Text Mode*), not necessarily full body.

- **IntelligenceBrief** — The user-*owned* analytical artifact built on top of a Story.
  This is the course's required "core business entity" (title, note, category, timestamp,
  capacity, cover image, owner). A Brief freezes a specific generation. Contrast: a Story
  is global and unowned; a Brief is personal and owned.

- **EvidenceSet** — The frozen, immutable list of exact Article snapshots (with stable
  evidence IDs like `A1`) used for one generation. "Frozen" means later Article edits do
  not change what a past generation was based on.

- **AnalysisClaim** — A single evidence-bearing statement produced by generation
  (consensus / source-specific / contradiction / caveat / lens-specific). A claim with no
  valid supporting evidence ID is invalid and must be rejected.

- **Citation / ClaimEvidence** — The link from a Claim to the specific Article(s) that
  support or contradict it. The invariant: *no displayed factual claim without a valid
  citation into its generation's EvidenceSet*.

- **GenerationRun** — One attempt to produce analysis from an EvidenceSet with a specific
  prompt+model. Records status, raw output, validation result, cost, and the *PromptTemplate
  version* used. Reproducible from its frozen EvidenceSet.

- **PromptTemplate** — A versioned prompt + generation-params record that Admin tunes to shape
  responses for everyone (tone, verbosity, lens emphasis, which claim types surface). Tunes the
  prompt only — never the citation-validation layer, which lives below it. (ADR-0021)

- **Flashcard** — A Student-owned Q/A study card generated from a Story/Brief. Its answer must
  cite evidence from a frozen EvidenceSet like any other claim; scheduled via spaced repetition
  (SM-2). (ADR-0021)

## Knowledge graph & timeline (Phase 3.5 — bounded, GKG-backed)

- **Entity** — A canonical person / organization / location resolved from GKG surface-name
  strings via an alias map + confidence threshold (borderline merges go to Admin review).
  Locations reuse GKG FeatureIDs (already disambiguated). (ADR-0018, ADR-0019)
- **EntityEdge** — A **co-occurrence** link between two Entities ("co-mentioned in the same
  article/Story"), each carrying its `source_article_id`(s). NOT a typed relation (acquired/
  sued/partnered) — typed edges are deferred post-course. An uncited edge is a bug. (ADR-0019)
- **Timeline** — A read view of a Story's Articles/EvidenceSets ordered over time (with GKG
  tone/volume overlays). Showing evolution only — NOT change-detection/alerting. (ADR-0020)

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

- **Publisher** — Who originates reporting. Owns rights fields.
- **IngestionConnector** — *How* Tessera discovers/receives data (RSS, GDELT_DOC, etc).
  A connector is not a publisher; a GDELT connector spans many publishers.
- **Analysis Text Mode** — What text is actually available for an Article: `feed_excerpt`,
  `api_content`, `licensed_full_text`, `manual_fixture`. Product wording must match the
  weakest mode in an EvidenceSet (never claim "publisher omitted X" from an excerpt).

## Deferred (startup-only, behind interfaces — NOT in graded build)

- **Typed RelationAssertion** — Typed edges (acquired/sued/partnered) beyond co-occurrence.
  GKG doesn't provide them; needs a separate LLM extraction pipeline. Highest risk. (ADR-0019)
- **Neo4j / Apache AGE** — The graph ships in **plain Postgres** tables + recursive CTEs; a
  dedicated graph store is an optional later projection, not built. (ADR-0019)
- **Broad cross-Story firehose graph** — rejected for the "noisy duplicate nodes" demo risk;
  the graph is bounded/curated (~50–200 nodes, scoped to the Story in view). (ADR-0019)
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

All decisions are recorded in `docs/adr/0001`–`0023`. ADR-0023 (2026-08-21) moves embedding
serving to a hosted API default after a system-RAM measurement on the demo machine; the
`vector(1024)` space and provider interface are unchanged. The 2026-07-26 additions
(ADR-0017–0022) un-defer the knowledge graph + timeline (GKG-backed, bounded), upgrade
embeddings (@ vector(1024)), pin the ingestion architecture (GDELT GKG firehose), add
role features (flashcards / Admin tuning / investor consensus), and revise the build order.
They **supersede** parts of ADR-0002 (→0019), ADR-0008 (→0017), ADR-0011 (→0020), ADR-0016
(→0022). `AGENTS.md` binds agents to v3 + these ADRs. The old `ai-news-intelligence-spec.md`
is a superseded draft — do not build from it.
