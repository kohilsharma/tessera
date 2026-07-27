# Tessera

**EVIDENCE-GROUNDED NEWS INTELLIGENCE**

**App Dev Lab Capstone — Project Confirmation and Initial Report**

| | |
|---|---|
| **Student** | Kohil Sharma |
| **Student ID** | 22f3001103 |
| **Term** | T22026_cs4010 |
| **Date** | 26 July 2026 |

> Reporting on one event is scattered across dozens of outlets, each with its own emphasis and its own gaps. Tessera collects that reporting, groups it into Stories, and builds analysis in which every claim names the article it came from.

| CITED SYNTHESIS | HYBRID SEARCH | KNOWLEDGE GRAPH | STORY TIMELINE |
|---|---|---|---|
| Consensus, single-source and contradicting claims, each carrying its citations | PostgreSQL full text fused with vector similarity | Entities and connections, every edge tied to an article | How the reporting developed, not only where it landed |

## Contents

1. [Basic Information](#1-basic-information) — 1
2. [Problem Statement](#2-problem-statement) — 1
3. [System Overview](#3-system-overview) — 2
4. [User Roles and Responsibilities](#4-user-roles-and-responsibilities) — 3
5. [Core Entity Design](#5-core-entity-design) — 4
6. [Feature Implementation Status](#6-feature-implementation-status) — 5
7. [Technology Stack and Purpose](#7-technology-stack-and-purpose) — 6
8. [Additional Features](#8-additional-features) — 6

---

## 1. Basic Information

| Field | Value | Field | Value |
|---|---|---|---|
| **Project** | Tessera | **Student** | Kohil Sharma |
| **Student ID** | 22f3001103 | **Email** | 22f3001103@ds.study.iitm.ac.in |
| **Term** | T22026_cs4010 | **Date** | 26 July 2026 |
| **Repository** | [github.com/kohilsharma/tessera](https://github.com/kohilsharma/tessera) | **Core Entity** | `IntelligenceBrief` |
| **Roles** | Admin, Student (Type A), Investor (Type B) | **Stack** | Node, Express, PostgreSQL, TypeORM, React |

## 2. Problem Statement

News about a single event is spread across many outlets. Each report carries its own emphasis, its own omissions and sometimes its own errors. A reader who wants an accurate picture has to read several reports and work out which facts are agreed on, which appear in only one place, and where two sources disagree. That takes time, so most people skip it and take one outlet's version.

Existing tools do not close the gap. Aggregators such as Google News group headlines but leave the reading and the reconciling to the user. AI summarisers write a paragraph and drop the link between what they wrote and the reporting it came from, so nothing can be checked. A fact carried by ten outlets looks identical to a claim made by one. Ask twice and the wording changes, with no record of what either version was based on.

Tessera will not display a claim it cannot attribute. Before analysis runs, the system freezes an `EvidenceSet`: the exact article snapshots being used, content hashed, each given a short identifier. The model may cite only those identifiers. The backend checks every citation against the frozen set and drops claims that fail. A saved analysis can be rebuilt from its stored inputs months later, and a reader can open any claim to see the reporting behind it, including reporting that contradicts it.

Three groups use the system. Students and researchers need a sourced explanation of an event they can cite in their own work, and study tools that keep the citations attached. Investors want business implications with the uncertainty stated and no trading advice. An administrator runs the connectors, reviews the quality of clustering and entity resolution, and inspects failures.

The point is an analysis a reader can defend rather than a summary they have to trust. Consensus, single-source claims and contradictions are three separate things on the page, each with its own citations, instead of one blended paragraph.

> **Scope.** Tessera does not publish news, rate outlets for bias, act as an autonomous fact-checker, or give financial advice. Investor output names stakeholders, mechanisms and uncertainty. It never produces buy or sell recommendations or price targets, and a deterministic language check enforces that rather than the prompt alone.

## 3. System Overview

Connectors pull article metadata and permitted text into PostgreSQL. A background worker embeds each article, removes duplicates and groups related articles into a Story. When a user asks for analysis, the system selects a bounded set of articles from that Story, freezes it, sends it to a language model, validates the citations that come back and stores the claims that survive. The user saves the result as an `IntelligenceBrief` they own.

Four surfaces sit around that spine. Hybrid search combines PostgreSQL full-text search with vector similarity over the same corpus. The knowledge graph shows the people, organisations and locations in a Story and how they connect, with every edge traceable to the article that produced it. The timeline orders a Story's reporting so a reader can see how it developed rather than only where it landed. Students generate flashcards from a Story, and the answers carry citations like any other claim.

### Figure 1 · Architecture and Data Flow

```text
┌────────────────────────────┐  ┌────────────────────────────┐  ┌────────────────────────────┐  ┌────────────────────────────┐
│ GDELT GKG 2.1              │  │ GDELT DOC 2.0              │  │ Curated RSS                │  │ Readability                │
│ 15-min files; entities,    │  │ keyword and theme search   │  │ breadth and freshness      │  │ text extraction, internal  │
│ themes, tone               │  │                            │  │                            │  │ use                        │
└────────────────────────────┘  └────────────────────────────┘  └────────────────────────────┘  └────────────────────────────┘

                         NORMALIZE · RIGHTS CHECK · DEDUPLICATE

┌─────────────────────────────────────────────────────────────┐  ┌─────────────────────────────────────────────────────────────┐
│ Express REST API                                            │  │ BullMQ worker, separate process                             │
│ JWT auth · RBAC middleware · ownership checks · Zod         │  │ ingestion · embedding · clustering · generation · entity   │
│ validation                                                  │  │ resolution                                                  │
└─────────────────────────────────────────────────────────────┘  └─────────────────────────────────────────────────────────────┘

                         POSTGRESQL HOLDS ALL BUSINESS TRUTH

┌────────────────────────────┐  ┌────────────────────────────┐  ┌────────────────────────────┐
│ PostgreSQL + pgvector      │  │ Redis                      │  │ TEI (bge-m3)               │
│ relational data · FTS ·    │  │ queues · cache · quotas    │  │ local embedding service    │
│ vector(1024) HNSW          │  │                            │  │                            │
└────────────────────────────┘  └────────────────────────────┘  └────────────────────────────┘

                 CLUSTER INTO STORIES, THEN FREEZE AN EVIDENCESET

┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Generation and citation validation                                                                                         │
│ swappable OpenAI-compatible provider, validate-and-repair loop, then every citation checked against the frozen            │
│ EvidenceSet; failing claims are dropped, never shown                                                                       │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────┐  ┌────────────────────────────────────┐  ┌────────────────────────────────────┐
│ Claims and citations               │  │ IntelligenceBrief                  │  │ Graph · timeline · flashcards      │
│ consensus · source-specific ·      │  │ the owned core entity              │  │ cited views over the same data     │
│ contradiction                      │  │                                    │  │                                    │
└────────────────────────────────────┘  └────────────────────────────────────┘  └────────────────────────────────────┘

       VITE + REACT SPA · THREE ROLE DASHBOARDS · LOADING, EMPTY, ERROR AND POPULATED STATES
```

### Components

- **API process.** Express, HTTP only. It never starts workers.
- **Worker process.** BullMQ consumers for ingestion, embedding, clustering, generation and entity resolution, keeping slow work off the request path.
- **PostgreSQL with pgvector.** One authoritative store. Embeddings and graph tables live here too.
- **Redis.** Queue transport, caching and per-role quota counters.
- **Provider interfaces.** `EmbeddingProvider` and `SynthesisProvider`, each with a deterministic mock so tests and frontend work run without an API key.
- **React SPA.** Vite, TypeScript, role-aware routing.

### Why the Core Entity Is the Brief

A Story is shared. Everyone sees the same one, so it has no natural owner. An `IntelligenceBrief` is what a user makes from a Story: a title, a note, a category, a capacity limit, a cover image and an owner. It pins one generation, so the analysis a user saved does not shift under them when the Story moves on.

## 4. User Roles and Responsibilities

The three roles are separated by endpoint and data, not by a flag in the UI. A Student and an Investor call different routes and receive different payloads. Middleware checks the role on every protected route and services check ownership again before touching a record, so a hand-written request to another role's endpoint returns 403.

### 4.1 Admin

The Admin runs the platform: `Publisher` records and their rights fields, connector configuration, manual runs, and inspection of ingestion failures.

Three queues carry real approval work. Borderline article-to-Story assignments wait for the Admin to accept, reject, move, merge or split. Entity name matches below a confidence threshold queue as merge candidates instead of merging automatically, because a wrong merge does more damage than a duplicate left alone. Failed and flagged generations are listed with their raw output. The Admin also owns versioned `PromptTemplate` records, which shape tone and emphasis for every user.

The dashboard shows connector health, ingestion counts, the clustering queue, the entity merge queue, recent generation runs and prompt templates. An Admin never owns another user's Brief.

### 4.2 Role Type A: Student

**Creates:** Briefs they own, study collections, and flashcard sets generated from a Story.

**Edits or deletes:** only their own records. Touching another user's Brief returns 403, and a Brief that does not exist returns 404.

**Dashboard:** study collections, guided reading over saved Stories, recent Briefs, flashcards due for review, citation export.

**Restrictions:** each Brief has an `articleCapacityLimit`, and the backend rejects attachments past it with 422, counting join rows rather than trusting the client. Students cannot reach Investor or Admin routes. A flashcard whose answer is not grounded in the frozen evidence is never produced.

### 4.3 Role Type B: Investor

**Actions:** search the corpus, keep a watchlist of entities and sectors, open the Investor lens on a Story, and request a cross-source consensus and contradiction view for a company or sector, showing where reporting agrees and where one source breaks from the rest.

**Core entity:** Investors own Briefs on the same terms as Students, but their Briefs pin an investor implication generation rather than a student context one.

**Dashboard:** watchlist, Stories filtered by tracked sectors, the consensus view, and their own Briefs.

**Restrictions:** investor output passes a prohibited-language check. Output that fails is withheld and flagged rather than shown. Investors cannot reach Student or Admin routes.

### Table 1 · Permission Matrix, Enforced at the API

| Capability | Admin | Student | Investor |
|---|---:|---:|---:|
| Manage publishers and connectors | Yes | No | No |
| Inspect ingestion runs | Yes | No | No |
| Review and correct clustering | Yes | No | No |
| Review entity merges | Yes | No | No |
| Manage prompt templates | Yes | No | No |
| Inspect raw generation output | Yes | No | No |
| Search and browse | Operational | Yes | Yes |
| Own Briefs, upload cover image | No | Yes | Yes |
| Student lens, collections, flashcards | No | Yes | No |
| Investor lens, watchlist, consensus view | No | No | Yes |
| Manage another user's Brief | No | No | No |

## 5. Core Entity Design

**CORE ENTITY: `INTELLIGENCEBRIEF`**

### Table 2 · Attributes and Mandated-Field Mapping

| Attribute | Type | Mandated Field | Notes |
|---|---|---|---|
| `id` | uuid PK | n/a | Primary key |
| `ownerId` | uuid FK, User | Ownership | Checked in the service layer, not only the UI |
| `storyId` | uuid FK, Story | n/a | The shared Story analysed |
| `title` | varchar NOT NULL | Title | Required, validated server side |
| `note` | text | Description | The user's own note |
| `category` | enum | Category | Constrained vocabulary |
| `lens` | enum | Type | `student_context` or `investor_implication` |
| `createdAt`, `updatedAt` | timestamptz | Timestamp | Set automatically |
| `articleCapacityLimit` | int, CHECK > 0 | Capacity | Counted over `BriefArticle`; 422 when exceeded |
| `coverImageKey` | varchar nullable | Media | Behind a `StorageProvider`; local disk for the demo |
| `frozenGenerationRunId` | uuid FK nullable | n/a | Pins the analysis shown |

### Relationships

- **User to Brief, one to many.** A user owns many Briefs and a Brief has one owner.
- **Story to Brief, one to many.** Several users can build Briefs on the same Story.
- **Brief to Article, many to many through `BriefArticle`.** The join table is where the capacity limit is enforced, and it records who pinned each article and when.
- **Story to Article, one to many,** produced by clustering.
- **Publisher to Article, one to many.** Rights and retention live on the Publisher and gate what may be stored.
- **Connector to Article, one to many,** recording how the article was found. A connector is not a publisher: one GDELT connector spans many publishers, which is why they are separate tables.
- **`GenerationRun` to `AnalysisClaim` to `ClaimEvidence` to `Article`,** the citation chain. Every claim carries at least one evidence row pointing into its run's frozen set.

### Table 3 · Entities by Phase

| Phase | Entities |
|---|---|
| **1 Foundation** | User, Role, Publisher, IngestionConnector, Story, Article, IntelligenceBrief, BriefArticle, Category |
| **2 Ingestion** | IngestionRun, GKG entity and theme staging |
| **3 Flagship** | EvidenceSet, EvidenceSetArticle, GenerationRun, AnalysisClaim, ClaimEvidence, PromptTemplate, Flashcard, Watchlist, Collection |
| **3.5 Graph** | Entity, EntityAlias, EntityEdge, EntityReviewTask |

The schema is built from TypeORM entities and reviewed migrations with `synchronize: false` everywhere, so no table is made by hand. Unique constraints cover user email, Story slug and article canonical URL. Check constraints cover the capacity limit and require every `ClaimEvidence` row to point at an article inside its run's evidence set. Indexes: GIN for full text, HNSW cosine on the `vector(1024)` column, and B-tree on date, category, owner and role. Transactions wrap Story merges, generation writes, and Brief creation with pinned articles.

## 6. Feature Implementation Status

The design work is complete: 22 architecture decision records, a domain glossary, a written Phase 1 specification covering 44 user stories, and eight implementation tickets with acceptance criteria and blocking order. Phase 1 build work is under way, starting from the project scaffold and authentication. Later phases have not started.

### Table 4 · Required Feature Areas

| # | Area | Status | Approach |
|---:|---|---|---|
| 1 | Multi-role system | **IN PROGRESS** | Three roles split by endpoint and data, with role-guard middleware on every protected route. |
| 2 | Core business entity | **IN PROGRESS** | `IntelligenceBrief` CRUD with all mandated fields, ownership checks and capacity enforcement. |
| 3 | Auth and authorization | **IN PROGRESS** | Single JWT access token, Argon2id hashing, RBAC in middleware plus ownership checks in services. |
| 4 | Dashboards | **IN PROGRESS** | Three dashboard endpoints returning different data, with the SPA routing each role to its own landing view. |
| 5 | Interaction and transaction | **IN PROGRESS** | Attaching articles to a Brief under a capacity limit, and later, generation writes committing run, claims and citations together. |
| 6 | Search and filtering | **IN PROGRESS** | Full-text and vector search fused by reciprocal rank fusion, with category filter, date range, sorting and pagination. |
| 7 | Review system | **PLANNED** | Admin review queues rather than user ratings: clustering assignments, entity merges, generation inspection. Phases 2 and 3.5. |
| 8 | Completion logic | **PLANNED** | No attendance concept applies to this domain. The equivalents are the `GenerationRun` status lifecycle and SM-2 scheduling for flashcards. Phase 3. |
| 9 | Extra features | **PLANNED** | Section 8. |

### Table 5 · Phases and Exit Criteria

| Phase | Scope | Exit Criterion |
|---|---|---|
| **1** | Foundation | Meets every mandatory course requirement on its own: auth, three distinct roles with API-level RBAC, the owned entity with all mandated fields, search with filtering and pagination, every UI state, and a seeded local demo. |
| **2** | Ingestion | Live connectors land multi-source articles and GKG entities in PostgreSQL. Timeboxed, with a fixture loader so the demo never depends on a live feed. |
| **3** | Flagship | Clustering, evidence freeze, synthesis and citation validation working end to end, with invalid claims provably rejected. Includes the three role-specific generation features. |
| **3.5** | Graph and timeline | A bounded entity graph and a Story timeline render for seeded Stories. |
| **4** | Evaluation | Clustering precision and recall, and generation pass rate, measured over fixtures. |

## 7. Technology Stack and Purpose

### Table 6 · Mandatory Stack

| Technology | Why It Is Used |
|---|---|
| **Express** | The REST API. Its middleware chain matches the authorization model this project needs: authenticate, then check role, then check ownership, composed per route. Routes stay thin and the business logic sits in services beneath them, so the worker can call the same logic without going through HTTP. |
| **PostgreSQL** | The single source of truth. This project needs foreign keys, check constraints, and transactions that commit a generation's run, claims and citations together, plus full-text search and vector similarity in one query. The pgvector extension keeps embeddings beside the relational data, and the knowledge graph is stored as ordinary tables walked with recursive CTEs, which avoids running a second database and keeping it in sync. |
| **TypeORM** | The schema is built from entity classes and reviewed migrations, with `synchronize: false` so no schema change is ever implicit. Its repositories sit behind the project's own repository interfaces, keeping ORM details out of the business layer, and it supports pgvector column types so the embedding column is part of the entity model. |
| **React** | The interface, as a Vite single-page app. The product sits entirely behind a login, so server rendering would buy nothing. React suits what this UI actually does: expandable citation drawers, polling for generation status, and three different role dashboards sharing one component set. TanStack Query handles server state and the loading, error and empty cases. |
| **JWT** | Stateless authentication. A signed access token is sent as a bearer header, verified by middleware on every protected route, and its role claim drives the role guard. Refresh-token rotation was left out on purpose: it is real surface area and a common source of session bugs, and it adds no required capability to a locally demonstrated build. The auth interface stays clean so rotation can be added later. |
| **Redis** | Queue transport for BullMQ, moving ingestion, embedding, clustering and model calls off the request path and into the worker. It also holds caches and per-role generation quotas. Chosen over a log-based broker because this project needs scheduling, retries and visible job status far more than event replay. |

### Table 7 · Additional Libraries and Services

| Technology | Purpose |
|---|---|
| **pgvector** | Vector similarity inside PostgreSQL. A `vector(1024)` column with an HNSW cosine index serves semantic search and clustering without a separate vector database. |
| **BullMQ** | Redis-backed queues and schedulers, giving idempotent jobs, bounded retries with backoff, and dead-letter visibility for the Admin. |
| **bge-m3 via TEI** | The embedding model, served locally in a container. Free, offline, MIT licensed, 1024 dimensions, multilingual, and its dense plus sparse output fits the hybrid search design. Cheap hosted APIs stay available behind the same interface. |
| **OpenAI-compatible LLM** | Structured synthesis. An inexpensive endpoint is chosen by environment variable and no model ID is hardcoded in any service, so the provider can be swapped without touching business logic. Guaranteed schema conformance is not available at this price, so the project runs its own validate-and-repair loop. |
| **Mock provider** | Deterministic in-repo implementations of both provider interfaces, so the test suite and everyday frontend work run with no API key and reproducible output. |
| **Zod** | Validation at both edges: incoming request bodies and outgoing model JSON. The validator that rejects a bad request also drives the repair loop that re-prompts the model with its own error. |
| **Argon2id** | Password hashing with a memory-hard function, per current OWASP guidance. |
| **GDELT GKG and DOC** | The ingestion backbone. GKG publishes files every fifteen minutes with people, organisations, locations, themes and tone already extracted from global news, supplying the entity layer the graph is built from. Free, open, no API key. |
| **@mozilla/readability** | Article text extraction for internal analysis only. Bodies are never redistributed, and per-source terms gate what may be stored. |
| **Cytoscape.js** | Renders the bounded entity graph, with node and edge caps and an evidence drawer on each edge. |
| **Vitest and Supertest** | Tests written first at the HTTP API seam, so authorization, ownership, validation and capacity rules are proven against a real database. |
| **Docker Compose** | Reproducible dependencies: PostgreSQL with pgvector, Redis and the embedding service. The app runs natively for speed, and a seed script gets a fresh clone to a populated demo. |

## 8. Additional Features

These go beyond the mandatory requirements. They are sequenced so the graded core is finished first, and each degrades to a smaller version rather than breaking if time runs short.

### Table 8 · Features Beyond the Core Requirements

| Feature | What It Does and Why It Is Useful | Technology | Status |
|---|---|---|---|
| **Cited synthesis over frozen evidence** | Produces consensus, source-specific and contradiction claims over a Story, cited separately. The backend drops any claim citing evidence outside the frozen set, which is what makes an inexpensive model safe to build on: correctness is enforced in code rather than trusted to the model. | OpenAI-compatible LLM behind a provider interface, Zod validation, bounded repair loop | **PHASE 3** |
| **Hybrid search** | Keyword and vector search run separately and are combined by reciprocal rank fusion. Keyword search misses coverage that uses different words, and vector search misses exact names and figures. Fusing by rank avoids normalising two differently scaled scores, a common source of ranking bugs. | PostgreSQL full text with GIN, pgvector with HNSW | **PHASE 1, IN PROGRESS** |
| **Live multi-source ingestion** | A fifteen-minute GKG polling loop, on-demand keyword search, curated RSS and text extraction, with layered deduplication and per-publisher rights checks. Real source diversity is what makes cross-source comparison mean anything, and the same pipeline feeds the graph. | Node connectors on BullMQ schedulers, readability, URL and hash deduplication | **PHASE 2** |
| **Bounded knowledge graph** | Roughly 50 to 200 canonical entities scoped to the Story in view, connected by co-occurrence edges, each edge naming the article it came from. Entity resolution uses a confidence threshold and sends borderline merges to the Admin. Bounding it keeps the graph readable instead of a hairball. | PostgreSQL tables with recursive CTEs, no graph database; Cytoscape.js | **PHASE 3.5** |
| **Story timeline** | Orders a Story's articles and evidence sets over time with tone and volume overlays, answering how a story developed rather than only where it ended up. The timestamps already exist, so the added cost is small. | Query and view over existing data | **PHASE 3.5** |
| **Role-specific generation** | Student flashcards with SM-2 scheduling and cited answers, Admin-owned versioned prompt templates that shape tone for everyone, and the Investor consensus and contradiction view. These make the roles different products over shared infrastructure. Admin tuning reaches the prompt only, never the citation check beneath it. | Additional tables and views over the existing pipeline | **PHASE 3** |
| **Evaluation harness** | Measures clustering precision and recall against labelled fixtures, and generation schema and citation pass rates, so prompt or model changes can be checked rather than guessed at. | Scripted suite over fixtures using the mock provider | **PHASE 4** |

**Deferred on purpose.** Typed entity relations, a dedicated graph database, a cross-story firehose graph, topic monitoring with alerts, refresh-token rotation, and any form of trading recommendation. Each has a documented interface or data-model path so it can be added later without rework.

---

*Tessera · Project Confirmation and Initial Report · Kohil Sharma · Term T22026_cs4010 · 26 July 2026*
