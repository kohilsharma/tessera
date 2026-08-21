# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tessera serves two equal-priority consumer audiences:

- Students and researchers comparing coverage, building defensible cited understanding, and studying from evidence.
- Investors comparing business implications, cross-source consensus, contradictions, and uncertainty without receiving trading advice.

Admins operate ingestion, review clustering and entity-resolution decisions, inspect generation failures, and tune versioned PromptTemplates. Admin is an operator role, not a Brief owner.

## Product Purpose

Tessera collects reporting from multiple outlets, groups related Articles into evolving Stories, and produces analysis where every displayed factual claim can be traced to an Article snapshot in a frozen EvidenceSet.

Success means users can distinguish consensus, source-specific claims, contradictions, and caveats; inspect supporting or contradicting reporting; and save reproducible analysis as an owned IntelligenceBrief. Course success also requires a complete, defensible local demo with every graded feature working end to end.

## Positioning

Tessera produces analysis a reader can defend rather than a summary they must trust. It freezes exact evidence before generation, permits the model to cite only that evidence, validates citations in backend code, and rejects claims that fail validation. Consensus, source-specific claims, and contradictions remain distinct instead of being blended into one summary.

## Operating Context

- Users search and browse a shared corpus of Stories and Articles, inspect cited analysis, and save a generation as an IntelligenceBrief.
- Students use guided reading, study collections, citation export, and evidence-grounded Flashcards.
- Investors use watchlists, sector-filtered Stories, and cross-source consensus and contradiction views with uncertainty stated.
- Admins monitor connectors and ingestion, resolve review queues, inspect GenerationRuns, and manage PromptTemplates.
- A Story evolves globally; an IntelligenceBrief is user-owned and pins one generation so saved analysis does not change as reporting develops.
- The product runs locally for course demonstration and must remain usable with seeded fixtures and deterministic mock providers when live feeds or paid model APIs are unavailable.

## Capabilities and Constraints

- Core artifacts and role names follow `CONTEXT.md`; ADRs override conflicting specifications.
- Three roles are enforced by distinct endpoints, payloads, API-level RBAC, and service-level ownership checks: Admin, Student, Investor.
- IntelligenceBrief is the owned core business entity. It includes title, note, category, timestamps, article capacity, cover image, owner, lens, Story, and frozen generation.
- No displayed factual claim may lack a valid citation into its GenerationRun's frozen EvidenceSet. This backend invariant is non-tunable.
- Every EntityEdge is a co-occurrence edge and carries its source Article. Typed relations are deferred.
- Entity resolution uses a confidence threshold; borderline merges enter Admin review.
- Search combines PostgreSQL full-text and vector results using reciprocal rank fusion, with filtering, sorting, and pagination.
- Article metadata may be stored. Article bodies are internal-only and are never redistributed. Product wording must respect the weakest Analysis Text Mode in an EvidenceSet.
- Investor output states stakeholders, mechanisms, and uncertainty. Deterministic validation rejects buy or sell recommendations and price targets.
- Tessera does not publish news, rate outlet bias, act as an autonomous fact-checker, provide financial advice, or ship monitoring and alerting in the graded build.
- Delivery follows course-first phased scope: Foundation, Ingestion, Flagship, graph and timeline, then Evaluation.
- Required stack: Node.js, Express, TypeORM, PostgreSQL with pgvector, Redis and BullMQ, and a Vite React SPA. No SSR, Python backend, Kafka, Neo4j, separate vector database, or hardcoded model IDs.

## Brand Commitments

- Product name: Tessera.
- Descriptor: Evidence-grounded news intelligence.
- Voice: precise, restrained, source-conscious, and explicit about uncertainty. Never imply certainty or source completeness unsupported by available evidence.
- Canonical product terminology and capitalization come from `CONTEXT.md`.

## Evidence on Hand

- `CONTEXT.md`: canonical domain glossary and invariants.
- `docs/adr/0001` through `docs/adr/0022`: accepted architecture and scope decisions; these override specifications when they conflict.
- `project-docs/Tessera_Master_Build_Specification_v3.md`: full product specification subject to ADR overrides.
- `project-docs/project-statement.md`: mandatory course requirements and evaluation criteria.
- `project-docs/Tessera_Initial_Report.md`: approved problem statement, roles, architecture, feature scope, and positioning.
- No testimonials, customer logos, deployment claims, performance benchmarks, or production usage evidence exists. Future work must not fabricate them.
- No confirmed logo or visual identity exists yet.

## Product Principles

1. Evidence before synthesis: freeze inputs first and make every factual output traceable.
2. Enforce trust below prompts: backend validation, ownership rules, and database constraints define what may be shown.
3. Separate agreement from disagreement: preserve consensus, source-specific claims, contradictions, caveats, and uncertainty as distinct information.
4. Make roles genuinely different: Student, Investor, and Admin workflows differ in endpoints, data, and outcomes.
5. Finish the defensible core first: prioritize complete end-to-end course delivery while retaining clean seams for later product growth.

## Accessibility & Inclusion

- Role-aware workflows must expose loading, empty, error, unauthorized, and populated states clearly.
- Evidence, contradictions, and uncertainty must remain understandable without relying on color alone.
- Interaction and content must support keyboard use, semantic structure, visible focus, and readable citations across desktop and mobile web.
