# Tessera — Master Build Specification v3

**Status:** Build specification for the expanded eight-week implementation window  
**Date:** July 25, 2026  
**Purpose:** A single source of truth for implementation, AI-assisted coding, the mandatory Project Confirmation Report, final documentation, and future startup development.  
**Supersedes:** Tessera Master Build Specification v2 and all earlier architecture drafts.

---

## 0. Read This First

Tessera is being built as a **real, extensible first release**, not as a disposable classroom demo. The implementation must be small enough to finish and defend in eight weeks, but its domain model, migrations, provenance, asynchronous processing, testing, and provider boundaries must be strong enough to survive continued development.

### 0.1 Non-negotiable course constraints

The following remain mandatory:

- Node.js with Express for the REST API.
- PostgreSQL as the primary relational database.
- TypeORM entities and migrations for programmatic database creation.
- React for the frontend.
- JWT-based authentication.
- API-level role-based access control.
- At least three meaningful non-join domain entities.
- Three roles with clearly different permissions and dashboards.
- A core owned business entity with title, description, timestamp, category, capacity, media support, and ownership.
- Advanced search/filtering, including pagination and sorting.
- Loading, error, empty, unauthorized, invalid-input, and not-found states.
- A complete local deployment for demonstration.

### 0.2 Architecture principle

Build a **modular monolith with asynchronous workers**:

- one repository;
- one Express application;
- one independently running Node worker process;
- one PostgreSQL database with pgvector;
- one Redis instance with BullMQ;
- one React application.

> **ADR-0019 supersedes the original Neo4j plan.** The knowledge graph ships in plain
> PostgreSQL tables traversed with recursive CTEs. Neo4j is explicitly deferred post-course;
> it is not part of the graded build. Apache AGE remains an optional later projection.

This is production-shaped without creating premature microservices.

### 0.3 Delivery tiers

Every feature is assigned to a delivery tier.

| Tier | Meaning | Rule |
|---|---|---|
| **P0 — Foundation** | Required for course compliance and a usable product | Must be complete and tested before any P2 feature begins |
| **P1 — Differentiation** | Defines Tessera as an intelligence product | Must be completed within the eight-week plan unless a documented blocker exists |
| **P2 — Expansion** | High-value startup capability | Implement only after its entry gate is met; must never destabilize P0/P1 |

### 0.4 Explicit technology decisions

**Use now:** Express, TypeORM migrations, PostgreSQL, pgvector, Redis, BullMQ Job Schedulers, React/Vite, Zod, Argon2id, OpenAI-compatible LLM (via env-configured provider), bge-m3 embeddings via TEI, Cytoscape.js, Docker Compose.

**Provider interfaces (ADR-0003):** `EmbeddingProvider` and `SynthesisProvider`, each with a deterministic Mock provider. No model ID is hardcoded in any service; the provider and model are chosen by environment variable. The OpenAI Responses API with Structured Outputs is one valid implementation of the SynthesisProvider interface, not a mandated dependency.

> **ADR-0017 supersedes the original embedding plan.** Default embedding model is `bge-m3`
> (BAAI, MIT) served locally via TEI at `vector(1024)` with HNSW cosine index. Cheap-API
> fallbacks: `voyage-3.5-lite` or `gemini-embedding-001` behind the same interface.

> **ADR-0019 supersedes the original graph plan.** The knowledge graph ships in plain
> PostgreSQL tables; Neo4j is explicitly deferred post-course.

**Do not introduce during this build:** Kafka, Kubernetes, a separate vector database, FastAPI as a primary API, unrestricted Common Crawl ingestion, a full local mirror of GDELT, mobile apps, recommendation systems, or autonomous publication of unreviewed graph relations.

---

## 1. Executive Architecture Decision

The final system combines the strongest parts of the previous plans:

1. **Master Blueprint v2 remains the application skeleton:** Express API, separate worker, PostgreSQL/pgvector, Redis/BullMQ, React, migrations, RBAC, owned Intelligence Briefs, quotas, structured AI output, and generation monitoring.
2. **GDELT becomes a first-class discovery connector:** not a replacement for publisher content and not a local firehose mirror.
3. **Story timelines become real domain data:** the timeline is a read view over a Story's Articles ordered over time (ADR-0020), not a generated entity. Optional `TimelineNode` materialization only if a query proves too slow.
4. **Claims and citations become normalized evidence records:** raw model JSON is retained, but important claims are searchable, reviewable, and linked to source articles.
5. **Story assignment becomes auditable:** `StoryArticle` replaces a bare `Article.storyId` relationship.
6. **Tracked topics and notifications are cut from the graded build** (ADR-0011, ADR-0020). The expensive "notify me what changed" change-detection + diffing + delivery system remains deferred. The Timeline *view* (showing a Story's evolution) still ships.
7. **An entity/relation graph becomes a bounded Phase 3.5 module** (ADR-0019): facts remain in PostgreSQL traversed with recursive CTEs; no Neo4j in the graded build. Entity resolution uses a confidence threshold with Admin review; edges are co-occurrence only, each carrying its `source_article_id`.
8. **AI quality becomes measurable:** prompt versions, evaluation cases, and evaluation runs are first-class concepts.

### 1.1 Product boundary

Tessera is not attempting to be a global news publisher, political-bias rating agency, trading-advice system, or fully autonomous fact-checking authority.

It is an **evidence-grounded news intelligence workspace** that:

- discovers and ingests permitted news metadata and analysis text;
- groups related reporting into evolving Stories;
- generates cited, reproducible multi-source analysis;
- exposes chronological developments;
- supports Student and Investor analytical lenses;
- tracks topics over time;
- extracts bounded entities and relations with evidence and review controls.

---

## 2. Product Brief

### 2.1 Problem statement

News reporting about one real-world event is fragmented across publishers, time zones, regions, and editorial priorities. Reading a single article gives one frame; reading many articles requires significant time and still leaves the reader to reconcile repeated facts, contradictions, new developments, and missing context manually.

### 2.2 Product promise

Tessera ingests reporting from curated connectors, discovers additional coverage through GDELT, clusters related articles into a persistent `Story`, and produces a structured intelligence view containing:

- consensus claims;
- source-specific claims;
- contradictions and uncertainty;
- coverage differences within the material available to the system;
- meaningful timeline developments;
- claim-level supporting and contradicting citations;
- a Student learning/context lens;
- an Investor implication/risk lens without price predictions or trade recommendations;
- entity and relationship context grounded in source evidence.

### 2.3 Product principles

1. **Every factual output is evidence-bearing.** A displayed claim without one or more known article IDs is invalid.
2. **Evidence sets are frozen.** Every generation records exactly which article versions were used.
3. **Analysis never exceeds the available data mode.** Feed excerpts support excerpt-level comparison; licensed or API content supports deeper comparison.
4. **Human correction is part of the architecture.** Admins can move articles, merge/split Stories, review entity merges, and reject relations.
5. **PostgreSQL is authoritative.** Vector and graph layers accelerate queries but do not own business truth.
6. **Models are replaceable.** Domain services depend on provider interfaces, not vendor SDKs.
7. **Quality is measured.** Prompts and models are evaluated against repeatable cases before changes are promoted.
8. **Data, not prediction.** Investor outputs identify stakeholders, sectors, mechanisms, risks, and uncertainty; they do not provide buy/sell/hold advice or numeric price targets.

### 2.4 Target users

#### Student

A learner, civil-services aspirant, researcher, or news-literate reader who wants a fast, source-aware explanation of an evolving event.

#### Investor

A reader who wants evidence-grounded business implications, affected entities, possible mechanisms, and uncertainty—without personalized financial advice.

#### Admin

A system operator who manages publishers/connectors, reviews clustering and entity quality, manages prompt versions and configurations, inspects failed generations, and monitors operational health.

### 2.5 Differentiation

Tessera’s defensible differentiation is not a claim that no other news product clusters stories or provides summaries. Its narrower structural distinction is:

> Tessera creates persistent, reproducible intelligence artifacts from frozen evidence sets, maps analytical claims and relationships to supporting or contradicting articles, stores how a Story changed over time, and supports role-specific analytical lenses and review workflows.

---

## 3. Course Compliance Matrix

| Course requirement | Tessera implementation |
|---|---|
| Node.js + Express | Express REST API in `apps/api` |
| PostgreSQL | Authoritative relational store |
| TypeORM | Entities, repositories, and reviewed migrations; `synchronize: false` |
| React | Single Vite/React frontend with role-aware routing |
| JWT auth | Short-lived access JWT plus rotating refresh sessions |
| Minimum three roles | Admin, Student, Investor |
| API-level RBAC | Middleware and service-level authorization checks |
| Role-aware dashboards | Distinct Admin, Student, and Investor landing experiences |
| Minimum three core entities | The system contains substantially more than three meaningful entities |
| Core business entity | `IntelligenceBrief` |
| Title/name | `IntelligenceBrief.title` |
| Description | `IntelligenceBrief.note` |
| Timestamp | `createdAt`, `updatedAt`, `lastCheckedAt` |
| Category/type | `category`, `lens` |
| Capacity/limit | `articleCapacityLimit` and evidence-selection bounds |
| Media support | Cover image through `FileStorageProvider` |
| Ownership | `IntelligenceBrief.ownerId -> User` |
| Search/filter | Hybrid keyword/semantic search, category, source, date, entity, status, sorting |
| Pagination | Keyset pagination for user-facing Story/Article lists; offset pagination acceptable for small Admin tables |
| Data integrity | Constraints, DTO validation, transactions, unique keys, rights checks |
| Loading/error/empty states | Required components and route behavior |
| Local demo | Docker Compose with Postgres, Redis, API, Worker, Web |

---

## 4. Roles and Permissions

### 4.1 Role provisioning

| Role | Provisioning |
|---|---|
| Admin | Backend seed/CLI only; no public registration route |
| Student | Public registration; default role |
| Investor | Public registration during the course build; designed to become a paid/gated tier later |

### 4.2 Permission matrix

| Capability | Admin | Student | Investor |
|---|---:|---:|---:|
| Manage publishers and connectors | Yes | No | No |
| Inspect ingestion runs | Yes | No | No |
| Review Story assignments | Yes | No | No |
| Merge/split Stories | Yes | No | No |
| Manage prompt versions | Yes | No | No |
| Run evaluation suites | Yes | No | No |
| Review entities/relations | Yes | No | No |
| Search Stories | Operational only | Yes | Yes |
| View consensus analysis | Operational only | Yes | Yes |
| View Student context lens | No | Yes | No |
| View Investor implication lens | No | No | Yes |
| Create owned Intelligence Briefs | No | Yes | Yes |
| Upload Brief cover image | No | Yes | Yes |
| Manage another user’s Brief | No | No | No |
| View raw generation output | Yes | No | No |

### 4.3 Authorization rules

- Frontend role checks are presentation logic only.
- Every protected route requires a verified access token.
- Role-specific actions require RBAC middleware and service-level checks.
- Owned resources require `resource.ownerId === authenticatedUser.id` unless the route is explicitly Admin-only.
- Admins do not implicitly become owners of user Briefs.
- Investor-only endpoints reject Student tokens with HTTP 403.
- Quota failures return HTTP 429 with a useful retry time.

---

## 5. User Journeys

### 5.1 Student journey

1. Register or sign in.
2. Search local Stories using keyword, semantic, date, source, category, and entity filters.
3. If coverage is insufficient, trigger a background discovery refresh using approved connectors, including GDELT DOC discovery.
4. Open a Story.
5. Explore:
   - concise overview;
   - consensus claims;
   - source-specific differences;
   - contradictions;
   - chronological timeline (Articles + EvidenceSets ordered over time, ADR-0020);
   - expandable citations;
   - entities and source distribution;
   - Student context, background, and unresolved questions.
6. Save an `IntelligenceBrief` with title, note, category, cover image, capacity, and selected evidence.
7. ~~Track the topic and receive notifications when new Story developments appear.~~ **Deferred (ADR-0011, ADR-0020):** TrackedTopic and notifications are not part of the graded build.
8. Re-open the Brief and compare its frozen generation with the latest Story generation.

### 5.2 Investor journey

1. Sign in as Investor.
2. Browse Stories prioritized by recency, affected sectors, entities, and validated signal strength.
3. Open a Story and first see the same evidence-backed consensus layer.
4. Open the Investor lens:
   - implication mechanism;
   - affected entities and sectors;
   - possible second-order effects;
   - uncertainty and caveats;
   - no trade recommendation or numeric target.
5. Save or track the Story as an Intelligence Brief.
6. ~~Receive a notification when a new Timeline Node materially changes the evidence.~~ **Deferred (ADR-0011, ADR-0020):** Notifications are not part of the graded build.

### 5.3 Admin journey

1. Inspect connector health and ingestion failures.
2. Review pending Story assignments and correct false merges/splits.
3. Inspect generation failures, citation validation failures, and flagged Investor outputs.
4. Review entity merge candidates and relation assertions.
5. Activate/deactivate prompt versions.
6. Run evaluation suites before changing model configuration.
7. Adjust typed SystemConfig values such as thresholds, quotas, evidence limits, and scheduling parameters.

---

## 6. System Architecture

```text
RSS feeds ────────────┐
Publisher APIs ───────┼────► Ingestion connectors
GDELT DOC discovery ──┘              │
                                     ▼
                           Normalize + deduplicate
                                     │
                                     ▼
                       PostgreSQL Article storage
                               + pgvector
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
        Story clustering       Entity extraction       Hybrid search
              │                      │
              ▼                      ▼
         StoryArticle          EntityMention
              │                      │
              ▼                      ▼
       Timeline generation     RelationAssertion
              │                      │
              └────────────┬─────────┘
                           ▼
                 Evidence selection/freeze
                           │
                           ▼
             Structured generation + validation
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       AnalysisClaim   TimelineNode   Investor lens
              │            │
              └──────┬─────┘
                     ▼
             IntelligenceBrief
                     │
              Student / Investor UI

PostgreSQL validated graph facts ──► graph traversal UI (Cytoscape.js)
```

> **ADR-0019 supersedes the original Neo4j projection.** The graph ships entirely in
> PostgreSQL tables traversed with recursive CTEs. No Neo4j in the graded build.

### 6.1 Runtime processes

| Process/service | Responsibility |
|---|---|
| `web` | React application |
| `api` | Express HTTP server only; never starts workers |
| `worker` | BullMQ workers and schedulers |
| `postgres` | Relational truth, full-text search, vector data, graph tables |
| `redis` | BullMQ queues, short-lived quotas, caching, locks |
| `tei` | bge-m3 embedding service (ADR-0017) |

### 6.2 Deployment rule

The system runs with the baseline Docker Compose services listed above. Graph APIs query
PostgreSQL recursive CTEs directly — no secondary graph database is required.

### 6.3 Scalability seams

| Seam | Initial implementation | Future replacement path |
|---|---|---|
| Queue | BullMQ/Redis | Kafka/SQS only when measured throughput or cross-service event distribution requires it |
| Vector search | pgvector | Dedicated vector system only after benchmarked limits |
| Graph traversal | PostgreSQL recursive CTEs | Neo4j/Arage or another graph service if the bounded graph outgrows CTE performance (post-course) |
| File storage | Local persistent volume | S3/GCS through `FileStorageProvider` |
| Generation | OpenAI Responses API | Other provider through `SynthesisProvider` |
| Embeddings | OpenAI embedding provider | Controlled re-embedding migration through `EmbeddingProvider` |
| Ingestion | RSS, GDELT DOC, publisher API adapters | Additional connectors without changing Article services |

---

## 7. Repository Structure

```text
newsneuron/
├── apps/
│   ├── api/
│   │   └── src/
│   ├── worker/
│   │   └── src/
│   └── web/
│       └── src/
├── packages/
│   ├── config/
│   ├── contracts/
│   ├── database/
│   ├── domain/
│   ├── ingestion/
│   ├── intelligence/
│   ├── observability/
│   ├── queue/
│   ├── search/
│   ├── security/
│   └── testing/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── api/
│   └── evaluation/
├── scripts/
├── docker-compose.yml
├── docker-compose.graph.yml
├── .env.example
└── README.md
```

### 7.1 Layering rule

```text
route/controller
      ↓
application service/use case
      ↓
domain rules + repository interfaces
      ↓
TypeORM/provider/queue adapters
```

Routes must not contain business logic. Provider SDK calls must not appear in controllers or domain entities.

---

## 8. Data Acquisition and Rights Model

### 8.1 Separate publisher from ingestion connector

A publisher owns or originates reporting. A connector is merely how Tessera discovers or receives data.

#### `Publisher`

- `id`
- `name`
- `domain`
- `homepageUrl`
- `termsUrl`
- `active`
- rights and retention fields
- `lastReviewedAt`
- `reviewNotes`

#### `IngestionConnector`

- `id`
- `type`: `RSS`, `GDELT_DOC`, `PUBLISHER_API`, `MANUAL`
- `publisherId` nullable
- `name`
- `endpointUrl`
- `configurationJson`
- `scheduleExpression`
- `active`
- `lastRunAt`

A GDELT connector has no single `publisherId` because one query returns many publishers.

### 8.2 Rights fields

Each Publisher must explicitly record:

- acquisition method;
- whether metadata may be stored;
- whether feed excerpts may be stored;
- whether full text may be stored;
- whether the material may be processed for summarization;
- whether derived summaries may be displayed;
- attribution requirements;
- retention days;
- date and notes of the latest review.

RSS is a discovery/acquisition mechanism, not a blanket legal license.

### 8.3 Analysis text modes

Every Article records the type of text actually available to analysis:

- `feed_excerpt`;
- `api_content`;
- `licensed_full_text`;
- `manual_fixture`;
- optional `user_supplied` in a later release.

The UI and generation prompts must use wording appropriate to the weakest mode present in the Evidence Set.

| Mode | Permitted product wording |
|---|---|
| Feed excerpts only | “Coverage differences found in available excerpts” |
| API/licensed content | “Differences across the supplied reports” |
| Mixed modes | “Differences within the material available to Tessera” |

### 8.4 GDELT role

GDELT is used for:

- broad article discovery through DOC API Article List results;
- GKG 15-minute firehose for entity/theme substrate (ADR-0018);
- source and geographic diversity;
- optional metadata enrichment using available GDELT fields;
- later research and aggregate analytics through BigQuery.

GDELT is not treated as:

- a full article-content license;
- the sole content source;
- a local dataset to mirror in full;
- a substitute for per-publisher rights configuration.

### 8.5 Core GDELT integration

`GdeltDocConnector` accepts:

- query;
- time window;
- language/source-country filters where supported;
- maximum results;
- sorting mode.

It maps returned records to `DiscoveredArticleCandidate`, then performs publisher resolution, URL normalization, deduplication, rights checks, and Article insertion.

### 8.6 GDELT expansion

After the DOC adapter is stable, optional enrichment may import:

- people;
- organizations;
- locations;
- themes;
- source country;
- tone or emotion metadata;
- precise publication timestamps where available.

Raw GKG/BigQuery integration is a P2 research connector, not the default ingestion path.

---

## 9. Core Data Model

The following model is intentionally richer than a minimal course project. Most records are created by pipelines and do not require separate CRUD screens.

### 9.1 Identity and security

#### `User`

- id
- email unique
- passwordHash
- role
- status
- createdAt
- updatedAt

#### `RefreshSession`

- id
- userId
- tokenHash
- familyId
- expiresAt
- rotatedAt
- revokedAt
- replacedBySessionId
- createdAt

### 9.2 Acquisition

#### `Publisher`

As defined in Section 8.

#### `IngestionConnector`

As defined in Section 8.

#### `IngestionRun`

- id
- connectorId
- status
- startedAt
- completedAt
- discoveredCount
- insertedCount
- duplicateCount
- rejectedByPolicyCount
- failedCount
- errorSummary
- cursor/checkpoint

### 9.3 Articles and embeddings

#### `Article`

- id
- publisherId
- discoveredByConnectorId
- externalId nullable
- url
- canonicalUrl unique where possible
- title
- analysisText
- analysisTextType
- author nullable
- language
- publishedAt
- fetchedAt
- exactHash
- normalizedTitleHash
- nearDuplicateHash nullable
- duplicateOfArticleId nullable
- duplicateReason nullable
- externalMetadata JSONB
- createdAt
- updatedAt

#### `ArticleEmbedding`

- id
- articleId
- provider
- model
- dimensions
- inputHash
- embedding `vector(1536)` for the initial provider
- active
- createdAt

A provider change is a controlled re-embedding and re-clustering migration, not merely an environment-variable change.

### 9.4 Stories and clustering

#### `Story`

- id
- slug
- canonicalTitle
- currentSummary nullable
- category nullable
- status: active, dormant, merged, archived
- firstSeenAt
- lastSeenAt
- currentCentroidEmbedding nullable
- currentClusteringVersion
- latestConsensusGenerationRunId nullable
- latestInvestorGenerationRunId nullable
- createdAt
- updatedAt

#### `StoryArticle`

- id
- storyId
- articleId
- assignmentMethod: auto, suggested, manual, migration
- assignmentStatus: auto_accepted, pending_review, manually_accepted, rejected, moved
- clusteringVersion
- semanticScore nullable
- entityOverlapScore nullable
- keywordScore nullable
- temporalScore nullable
- categoryScore nullable
- totalScore nullable
- assignedByUserId nullable
- assignedAt
- removedAt nullable

Unique active membership constraints must prevent accidental duplicate active assignments.

### 9.5 Evidence and generation

#### `EvidenceSet`

- id
- storyId
- selectionStrategy
- selectionStrategyVersion
- dataMode
- distinctPublisherCount
- articleCount
- createdAt

#### `EvidenceSetArticle`

- evidenceSetId
- articleId
- evidenceId such as `A1`
- articleContentHash
- sourceRank
- selectionReason
- includedExcerptSnapshot

#### `GenerationRun`

- id
- storyId
- intelligenceBriefId nullable
- evidenceSetId
- triggeredByUserId nullable
- promptVersionId
- generationType
- provider
- requestedModel
- returnedModel
- status
- refusalReason nullable
- rawResponse JSONB nullable
- validationResult JSONB nullable
- inputTokens nullable
- outputTokens nullable
- estimatedCost nullable
- latencyMs nullable
- escalatedFromRunId nullable
- failureCode nullable
- failureMessage nullable
- startedAt
- completedAt nullable
- createdAt

Statuses:

- queued;
- selecting_evidence;
- generating;
- validating;
- persisting;
- completed;
- failed;
- flagged;
- superseded.

### 9.6 Claims and citations

#### `AnalysisClaim`

- id
- generationRunId
- claimType
- text
- confidence nullable
- importance nullable
- displayOrder
- reviewStatus
- createdAt

Claim types include:

- consensus;
- source_specific;
- contradiction;
- coverage_difference;
- unresolved_question;
- student_context;
- investor_implication;
- caveat.

#### `ClaimEvidence`

- id
- claimId
- articleId
- relationship: supports, contradicts, context, not_found_in
- evidenceExcerpt nullable
- articleContentHash
- createdAt

### 9.7 Timeline

#### `TimelineNode`

- id
- storyId
- generationRunId
- eventTime
- headline
- summary
- nodeType
- confidence nullable
- sequenceNumber
- reviewStatus
- createdAt

#### `TimelineNodeEvidence`

- timelineNodeId
- articleId
- relationship
- evidenceExcerpt nullable

### 9.8 Core owned business entity

#### `IntelligenceBrief`

- id
- ownerId
- storyId
- title
- note
- category
- lens: consensus, student_context, investor_signal
- coverImageKey nullable
- articleCapacityLimit
- frozenGenerationRunId nullable
- status
- createdAt
- updatedAt
- lastCheckedAt nullable

This entity satisfies the course’s required owned core business entity.

#### `BriefArticle`

- briefId
- articleId
- pinnedAt
- pinnedByUserId

The backend rejects additions that exceed `articleCapacityLimit`.

### 9.9 Monitoring product (DEFERRED — ADR-0011, ADR-0020)

> **ADR-0011 and ADR-0020 cut the monitoring mini-product from the graded build.**
> TrackedTopic, TrackedTopicRun, and Notification entities, their API routes, and their
> queue jobs are all deferred. The Timeline *view* (showing a Story's evolution) still ships,
> but change-detection + alerting does not. These entity definitions are retained for
> reference; they will not be built in the eight-week course window.

#### `TrackedTopic`

- id
- ownerId
- name
- query
- category nullable
- connectorFilters JSONB
- schedulePolicy
- active
- lastRunAt nullable
- createdAt
- updatedAt

#### `TrackedTopicRun`

- id
- trackedTopicId
- status
- discoveredArticleCount
- insertedArticleCount
- newStoryCount
- updatedStoryCount
- startedAt
- completedAt

#### `Notification`

- id
- userId
- type
- storyId nullable
- briefId nullable
- title
- message
- metadata JSONB
- readAt nullable
- createdAt

### 9.10 Quality and configuration

#### `PromptVersion`

- id
- name
- promptType
- version
- instructions
- outputSchemaVersion
- defaultModelPolicy JSONB
- active
- createdByAdminId
- createdAt

#### `EvaluationCase`

- id
- name
- category
- inputDefinition JSONB
- expectedDefinition JSONB
- prohibitedDefinition JSONB
- active
- createdAt

#### `EvaluationRun`

- id
- evaluationCaseId
- promptVersionId
- provider
- model
- schemaValidity
- citationValidity
- claimSupportScore
- relationEvidenceScore nullable
- timelineOrderScore nullable
- prohibitedContentScore
- latencyMs
- estimatedCost
- passed
- details JSONB
- createdAt

#### `SystemConfig`

- id
- key unique
- valueJson
- valueType
- schemaVersion
- updatedByAdminId
- updatedAt

All configuration updates are validated through key-specific Zod schemas.

### 9.11 Entity intelligence module

#### `Entity`

- id
- canonicalName
- entityType
- description nullable
- wikidataId nullable
- resolutionConfidence nullable
- reviewStatus
- createdAt
- updatedAt

#### `EntityAlias`

- id
- entityId
- alias
- normalizedAlias
- source
- confidence nullable

#### `EntityMention`

- id
- entityId nullable
- articleId
- surfaceText
- entityType
- contextExcerpt
- confidence
- resolutionStatus
- createdAt

#### `RelationAssertion`

- id
- subjectEntityId
- objectEntityId
- relationType
- rawRelation nullable
- eventTime nullable
- confidence
- generationRunId
- reviewStatus
- createdAt

#### `RelationEvidence`

- id
- relationAssertionId
- articleId
- evidenceExcerpt
- articleContentHash
- createdAt

#### `EntityReviewTask`

- id
- taskType: merge_candidate, unresolved_mention, relation_review
- payload JSONB
- status
- assignedToAdminId nullable
- resolution JSONB nullable
- createdAt
- resolvedAt nullable

---

## 10. Database Integrity, Indexing, and Migration Rules

### 10.1 Migration policy

- `synchronize: false` in every environment.
- All schema changes use reviewed TypeORM migrations.
- Destructive migrations require a backup/export step and a rollback note.
- The pgvector extension is created by migration.

### 10.2 Important constraints

- User email unique and normalized.
- Article canonical URL unique where present.
- Article exact hash indexed.
- Publisher domain indexed.
- Story slug unique.
- `IntelligenceBrief.articleCapacityLimit > 0`.
- Evidence IDs unique within an Evidence Set.
- ClaimEvidence must reference an Article included in the Generation Run’s Evidence Set.
- RelationEvidence must reference an Article that was available to the generating run.
- Investor lens output cannot be marked completed if prohibited-language validation fails.
- Licensed full text cannot be stored for a Publisher whose rights policy forbids it.

### 10.3 Search indexes

- GIN full-text indexes on Article title/analysis text and Story title/current summary.
- B-tree indexes on publication dates, Story status, connector/run status, ownership, and role.
- Exact vector search initially; optional HNSW index after benchmark or as a non-load-bearing migration.
- Index active StoryArticle membership and pending review queues.

### 10.4 Transaction boundaries

Transactions are required for:

- refresh-token rotation;
- Story merge/split;
- assignment moves;
- generation persistence of run + claims + citations + timeline nodes;
- Brief creation with pinned articles;
- entity merge operations.

---

## 11. REST API Specification

All routes are prefixed with `/api/v1`.

### 11.1 Authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Register Student or Investor |
| POST | `/auth/login` | Public | Access token + refresh cookie |
| POST | `/auth/refresh` | Refresh cookie | Rotate refresh session |
| POST | `/auth/logout` | Authenticated | Revoke current session |
| POST | `/auth/logout-all` | Authenticated | Revoke all user sessions |
| GET | `/auth/me` | Authenticated | Current user and role |

### 11.2 Search and Stories

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/search` | Student/Investor | Hybrid search across Stories and Articles |
| POST | `/search/discover` | Student/Investor | Queue connector refresh when coverage is insufficient |
| GET | `/stories` | Student/Investor | Filtered/keyset-paginated Story list |
| GET | `/stories/:storyId` | Student/Investor | Story overview and current analysis |
| GET | `/stories/:storyId/articles` | Student/Investor | Evidence/source list |
| GET | `/stories/:storyId/timeline` | Student/Investor | Timeline Nodes and evidence |
| GET | `/stories/:storyId/claims` | Student/Investor | Claims and citations |
| GET | `/stories/:storyId/entities` | Student/Investor | Entities and relation summary |
| POST | `/stories/:storyId/generations` | Student/Investor | Request permitted lens generation |
| GET | `/generation-runs/:runId` | Authorized viewer | Poll run status and public-safe result metadata |

### 11.3 Briefs

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/briefs` | Student/Investor | Create owned Brief, optional image upload |
| GET | `/briefs/mine` | Student/Investor | Owner-scoped list |
| GET | `/briefs/:briefId` | Owner | Frozen Brief view |
| PATCH | `/briefs/:briefId` | Owner | Update metadata/capacity |
| DELETE | `/briefs/:briefId` | Owner | Delete Brief |
| POST | `/briefs/:briefId/articles` | Owner | Pin Article subject to capacity |
| DELETE | `/briefs/:briefId/articles/:articleId` | Owner | Unpin Article |
| POST | `/briefs/:briefId/refresh` | Owner | Generate a new frozen version |
| GET | `/briefs/:briefId/changes` | Owner | Compare frozen run with current Story run |

### 11.4 Tracked topics and notifications (DEFERRED — ADR-0011, ADR-0020)

> **Deferred from the graded build.** These routes will not be implemented in the eight-week
> course window. Retained for reference.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/tracked-topics` | Student/Investor | Create tracked topic |
| GET | `/tracked-topics/mine` | Student/Investor | List tracked topics |
| PATCH | `/tracked-topics/:id` | Owner | Update query/schedule/status |
| DELETE | `/tracked-topics/:id` | Owner | Delete topic |
| POST | `/tracked-topics/:id/run` | Owner | Manual refresh subject to quota |
| GET | `/notifications` | Student/Investor | Paginated notifications |
| PATCH | `/notifications/:id/read` | Owner | Mark read |

### 11.5 Graph API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/entities/:entityId` | Student/Investor | Entity profile |
| GET | `/entities/:entityId/stories` | Student/Investor | Stories containing entity |
| GET | `/entities/:entityId/graph` | Student/Investor | Bounded 1–2 hop graph |
| GET | `/relations/:relationId` | Student/Investor | Relation and evidence |

Graph endpoints enforce node/edge limits, depth limits, time filters, confidence filters, and relationship-type filters.

### 11.6 Admin APIs

Admin routes include:

- Publisher CRUD and rights review;
- connector CRUD, activation, and manual run;
- ingestion-run inspection;
- pending Story assignment queue;
- Story merge, split, move, reject, and recluster actions;
- generation-run inspection and retry;
- prompt-version create/activate/deactivate;
- evaluation-case CRUD and evaluation execution;
- entity/relation review queues;
- typed configuration management;
- operational statistics and health.

---

## 12. Queue and Background Job Design

Use BullMQ Job Schedulers rather than deprecated repeatable-job APIs.

### 12.1 Queues

- `ingestion`
- `article-processing`
- `story-processing`
- `generation`
- `entity-processing`
- `maintenance`
- `evaluations`

### 12.2 Jobs

| Job | Trigger | Output |
|---|---|---|
| `run-connector` | Scheduler/Admin | IngestionRun + discovered candidates |
| `normalize-article` | Connector result | Normalized candidate |
| `persist-article` | Normalized candidate | Article or duplicate link |
| `embed-article` | New/changed Article | ArticleEmbedding |
| `assign-story` | Active embedding | StoryArticle assignment/review task |
| `refresh-story-centroid` | Assignment change | Updated Story centroid |
| `select-evidence` | Generation request | EvidenceSet |
| `generate-story-analysis` | EvidenceSet | GenerationRun raw response |
| `validate-generation` | Raw response | Validated result or escalation |
| `persist-intelligence` | Validated result | Claims, citations, timeline nodes |
| `extract-entities` | New analysis/evidence | Entity mentions |
| `run-evaluation-suite` | Admin/CI | EvaluationRuns |

> **Deferred jobs (ADR-0011, ADR-0019, ADR-0020):** `run-tracked-topic`,
> `notify-story-change`, `extract-relations`, and `project-graph` are not part of the
> graded build. Retained for reference.

### 12.3 Reliability requirements

- Jobs are idempotent using stable job keys.
- External calls use bounded retries with exponential backoff and jitter.
- Permanent policy failures are not retried.
- Dead-letter/finally-failed jobs remain visible to Admins.
- Worker concurrency is configured per queue.
- Database writes use unique constraints to survive at-least-once delivery.
- A job never marks success until all authoritative PostgreSQL data is committed.

---

## 13. Ingestion Pipeline

### 13.1 RSS path

1. Scheduler finds active RSS connectors due to run.
2. Connector fetches and parses feed.
3. Each item becomes `DiscoveredArticleCandidate`.
4. Resolve Publisher.
5. Enforce rights policy.
6. Normalize URL, title, date, language, and excerpt.
7. Detect exact/near duplicates.
8. Insert Article and enqueue processing.

### 13.2 GDELT DOC path

1. Admin-triggered or scheduled GDELT query.
2. Adapter retrieves Article List JSON/JSONFeed results.
3. Each result is resolved to a Publisher by domain.
4. Unknown Publishers may be inserted as inactive/unreviewed or rejected according to config.
5. Rights policy determines whether metadata/excerpt analysis is permitted.
6. Candidates are deduplicated against all other connectors.
7. Accepted Articles enter the normal embedding and clustering pipeline.

### 13.3 Publisher API path

Publisher-specific APIs may return richer content. The connector must map the content mode and rights flags explicitly.

### 13.4 Deduplication

Use layered deduplication:

1. normalized canonical URL;
2. exact content hash;
3. normalized title hash within a time window;
4. SimHash/MinHash candidate similarity;
5. optional embedding similarity plus publisher/time checks.

Do not delete all duplicates. Preserve publisher variants when their wording or framing is analytically useful; link exact wire copies using `duplicateOfArticleId`.

---

## 14. Hybrid Search and Story Clustering

### 14.1 Search

Combine:

- PostgreSQL full-text rank;
- semantic similarity;
- recency;
- category/source/entity filters;
- Story status;
- optional diversity reranking.

Return explainable metadata such as keyword rank and semantic score to Admin tools, not necessarily to ordinary users.

### 14.2 Initial semantic model

Use an environment-configured embedding provider. Initial default:

- OpenAI `text-embedding-3-small`;
- 1,536 dimensions;
- input: normalized title + permitted analysis text.

### 14.3 Composite clustering score

```text
cluster_score =
  semantic_similarity      * configurable_weight
+ entity_overlap           * configurable_weight
+ title_keyword_overlap    * configurable_weight
+ temporal_proximity       * configurable_weight
+ category_compatibility   * configurable_weight
+ source_diversity_bonus   * configurable_weight
```

The initial implementation may begin with semantic + temporal + title overlap, then add entity/category components during Week 3/6. Weights and thresholds are typed configuration, never unexplained constants.

### 14.4 Three outcomes

- High score: auto-accept assignment.
- Middle score: attach as pending review or create a candidate task without affecting published synthesis.
- Low score: seed a new Story.

Safer rule: pending-review Articles are excluded from published analysis until accepted.

### 14.5 Admin correction operations

- accept/reject candidate assignment;
- move Article;
- merge Stories;
- split Story;
- mark duplicate;
- reactivate dormant Story;
- run reclustering under a new clustering version.

### 14.6 Clustering evaluation

Create a labelled fixture containing at least:

- 40 same-event pairs;
- 40 related-topic but different-event pairs;
- 40 unrelated pairs.

Measure precision, recall, F1, false-merge rate, and false-split rate. False-merge rate is the release-critical metric because unrelated articles corrupt downstream synthesis.

---

## 15. AI Provider and Model Architecture

### 15.1 Provider interfaces

```ts
interface EmbeddingProvider {
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
}

interface SynthesisProvider {
  generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<StructuredGenerationResult<T>>;
}

interface EntityExtractionProvider {
  extract(request: EntityExtractionRequest): Promise<EntityExtractionResult>;
}
```

Implement:

- OpenAI provider;
- deterministic Mock provider;
- optional future Anthropic/Gemini providers.

### 15.2 Current defaults (ADR-0003, ADR-0017)

Use environment configuration, not hardcoded business logic. **No model ID is hardcoded in any service.**

```env
# Embeddings (ADR-0017 supersedes the original text-embedding-3-small plan)
EMBEDDING_PROVIDER=local                    # local | openai | voyage | gemini
EMBEDDING_MODEL=bge-m3                      # served via TEI Docker container
EMBEDDING_DIMENSIONS=1024                   # vector(1024) with HNSW cosine index

# Synthesis — cheap OpenAI-compatible models, swappable via env
SYNTHESIS_PROVIDER=openai-compatible        # openai-compatible | mock
SYNTHESIS_MODEL=gpt-4.1-nano                # high-volume extraction (was "Luna")
SYNTHESIS_MODEL_FLAGSHIP=gpt-4.1            # flagship synthesis (was "Terra")
SYNTHESIS_MODEL_ESCALATION=gpt-5.5          # difficult/failed case escalation (was "Sol")
```

**Embedding fallbacks (ADR-0017):** `voyage-3.5-lite` ($0.02/1M tokens) or `gemini-embedding-001`
(Google AI Studio free tier). Both truncate cleanly to 1024 dims; exposed through the
`EmbeddingProvider` interface — same vector space, no re-index on swap within a model family.

> **Original plan (superseded):** `text-embedding-3-small` at `vector(384)` was the initial
> embedding choice. ADR-0017 upgraded to bge-m3 @ `vector(1024)` for quality and Matryoshka
> flexibility. The old model names (Luna/Terra/Sol) are retained as comments for reference
> but the env vars now use generic names.

Recommended policy:

- cheap model for bulk extraction or inexpensive development passes;
- flagship model for Story synthesis and relation extraction;
- escalation model for deterministic escalation of difficult/failed cases;
- model snapshots where reproducibility is important and available.

### 15.3 API

Use the OpenAI Responses API for new generation code and Structured Outputs with strict JSON Schema. Keep the provider interface compatible with Chat Completions only as a fallback for already-working code.

### 15.4 Mocking

All integration tests and ordinary frontend development must work with a deterministic mock provider. A live API key must not be required to test authentication, ownership, search, queues, or UI states.

### 15.5 Escalation triggers

Escalation is based on deterministic failures, not solely self-reported model confidence:

- refusal;
- schema failure;
- citation ID outside Evidence Set;
- required claim without evidence;
- invalid timeline ordering;
- relation without valid evidence;
- prohibited Investor language;
- insufficient distinct publishers;
- validation score below configured threshold.

If escalation also fails, mark the run flagged/failed and show a safe unavailable state. Do not silently serve invalid intelligence.

---

## 16. Evidence Selection and Provenance

### 16.1 Evidence selection goals

Evidence selection must balance:

- relevance;
- source diversity;
- chronology;
- coverage mode;
- cost/context limits;
- avoidance of duplicate wire copies.

### 16.2 Default bounds

Initial defaults, configurable:

- maximum 10 Articles per Evidence Set;
- maximum 2 Articles per Publisher;
- minimum 2 distinct Publishers for comparative synthesis;
- include earliest and latest eligible reporting;
- prefer accepted, non-duplicate Articles;
- exclude pending/rejected Story assignments.

### 16.3 Frozen input

For every Evidence Set store:

- Article ID;
- stable evidence ID (`A1`, `A2`, etc.);
- Article content hash;
- exact excerpt snapshot used;
- selection reason;
- source rank.

### 16.4 Structured Story schema

The exact JSON Schema belongs in versioned code and `PromptVersion`. Conceptually it must include:

- executive summary;
- evidence-bearing consensus claims;
- source-specific claims;
- contradictions;
- coverage differences;
- unresolved questions;
- timeline nodes;
- category tags;
- confidence metadata.

Each factual object includes known evidence IDs.

### 16.5 Backend citation validation

The backend rejects output when:

- an evidence ID is not in the run’s Evidence Set;
- a factual claim has no supporting evidence;
- a contradiction has no relevant evidence on both sides;
- a Timeline Node has no evidence;
- a Relation Assertion has no evidence;
- an `ArticleContentHash` no longer matches the frozen value during persistence.

### 16.6 Coverage-difference wording

Do not use “publisher omitted X” unless the system has the full permitted report and the claim is carefully framed. Default wording:

- “not found in the available excerpt”;
- “reported by A and B but not present in the material available from C”;
- “coverage difference within the selected evidence set.”

---

## 17. Timeline Intelligence

> **ADR-0020 supersedes the original Timeline Node generation plan.** The timeline is a
> **read view over existing data** — a Story's Articles (and EvidenceSets/Briefs) ordered
> on a time axis, with tone/volume overlays from GKG fields. No change-detection, no
> diffing, no notifications. Optional `TimelineNode` materialization only if a live query
> proves too slow; keep it a projection, not a source of truth.

### 17.1 Timeline as a read view

The timeline answers "how this story developed" rather than "what changed since I last looked."
Each timeline point ties back to Articles and EvidenceSets — it is a query and a visualization
over data that already exists, not a new extraction or change-detection engine.

### 17.2 Data sources for the timeline

- Article `seendate` / published timestamps (from ingestion, ADR-0018)
- GKG tone and volume overlays (free from GKG fields)
- EvidenceSet creation timestamps
- GenerationRun timestamps (when analysis was produced)

### 17.3 Original plan (retained for reference)

The original spec proposed generated Timeline Nodes as model-output entities with event time,
headline, evidence, confidence, and chronological ordering. ADR-0020 determined that this is
unnecessary new infrastructure — the Articles already carry timestamps and the GKG fields
provide tone/volume. The generated-node approach may be revisited post-course if the read-view
proves insufficient.

### 17.4 Generation (original, retained for reference)

The model originally proposed Timeline Nodes with:

- event time;
- headline;
- summary;
- node type;
- evidence IDs;
- confidence.

The backend validates dates against evidence metadata and stores TimelineNodeEvidence.

### 17.3 "What changed" (DEFERRED — ADR-0011, ADR-0020)

> **ADR-0011/0020 cut change-detection and notifications from the graded build.**
> The "what changed" comparison and notification delivery are deferred. The Timeline
> *view* still ships, but automated comparison and alerting does not.

When a new generation completes (post-course):

1. compare current Evidence Set and prior active generation;
2. classify added/removed/changed claims;
3. identify new Timeline Nodes;
4. determine whether the change is material;
5. notify tracked-topic owners when configured.

### 17.4 Timeline UI

- chronological vertical timeline;
- filters by date and node type;
- expandable evidence;
- badges for new/updated/corrected nodes;
- link to corresponding entity graph context;
- comparison mode between frozen Brief and latest Story.

---

## 18. Entity and Relationship Intelligence

### 18.1 Scope

The graph module is bounded to the entities and relations supported by the available evidence. It is not a claim to globally resolve every person or company.

### 18.2 Entity types

Initial types:

- person;
- organization;
- company;
- government body;
- location;
- product;
- policy/law;
- event;
- sector/theme.

### 18.3 Controlled relation vocabulary

Initial typed relations:

- acquired;
- appointed;
- resigned_from;
- sued;
- invested_in;
- partnered_with;
- regulated_by;
- sanctioned;
- member_of;
- located_in;
- announced;
- affected_by;
- co_mentioned_with.

`co_mentioned_with` is permitted when no stronger factual relation is justified.

### 18.4 Extraction pipeline

1. extract mentions from frozen evidence;
2. type mentions;
3. resolve exact aliases;
4. generate candidate entities using name/alias/context/embedding signals;
5. auto-link only at high confidence;
6. create Admin review tasks for ambiguous merges;
7. extract bounded relations using strict schema;
8. validate evidence IDs and excerpts;
9. persist RelationAssertions and RelationEvidence;
10. publish only approved or high-confidence relations according to policy.

### 18.5 Entity resolution

Resolution layers:

1. exact normalized canonical-name or alias match;
2. Wikidata ID match when available;
3. contextual similarity using co-occurring entities, type, location, and time;
4. embedding similarity;
5. model adjudication;
6. Admin review for borderline cases.

A wrong merge is more harmful than an unresolved duplicate. Prefer conservative non-merging.

### 18.6 PostgreSQL source of truth

Entities and Relations are authoritative PostgreSQL rows with constraints and evidence. The application must be able to answer bounded graph queries from PostgreSQL.

### 18.7 Optional Neo4j projection (DEFERRED — ADR-0019)

> **ADR-0019 defers Neo4j post-course.** The knowledge graph ships in plain PostgreSQL
> tables traversed with recursive CTEs. Neo4j is an optional post-course projection for
> when the graph outgrows what Postgres CTEs handle comfortably.

Neo4j *would* become useful for:

- bounded multi-hop traversal;
- time-filtered relationship exploration;
- entity neighborhoods;
- path queries;
- graph visualization and future graph algorithms.

Projection rules (post-course only):

- project only validated/approved entities and relations;
- use PostgreSQL IDs as immutable graph IDs;
- store projection version and checkpoint;
- allow full rebuild;
- never write authoritative edits directly to Neo4j.

### 18.8 Graph UI

Use Cytoscape.js with:

- 1-hop default, 2-hop optional;
- node and edge caps;
- relation-type filters;
- time-window filter;
- confidence/review-status filter;
- source evidence drawer;
- links to Story timeline and source articles.

---

## 19. Tracked Topics and Notifications (DEFERRED — ADR-0011, ADR-0020)

> **ADR-0011 and ADR-0020 cut the monitoring mini-product from the graded build.**
> TrackedTopic, TrackedTopicRun, and Notification entities, their API routes, and their
> queue jobs are all deferred. The Timeline *view* (showing a Story's evolution) still ships,
> but change-detection + alerting does not. This section is retained for reference; it will
> not be built in the eight-week course window.

### 19.1 Tracked Topic behavior

A user tracks a query such as “Indian semiconductor policy.” A Job Scheduler periodically:

1. searches local data;
2. runs configured RSS/publisher connectors;
3. queries GDELT DOC discovery;
4. processes new Articles;
5. updates/creates Stories;
6. generates intelligence only when material evidence changes;
7. creates notifications.

### 19.2 Material-change rules

Notify only when configured conditions occur:

- new accepted Article from a new Publisher;
- new Timeline Node;
- new contradiction;
- material Investor implication change;
- Story status reactivated;
- previously flagged analysis becomes valid.

### 19.3 Quotas

Redis counters enforce daily limits by role and operation. Persisted Usage Events are recommended now because the project includes analytics and a future paid tier.

#### `UsageEvent`

- id
- userId
- operation
- units
- metadata
- createdAt

---

## 20. Authentication and Security

### 20.1 Passwords

Use Argon2id with configuration reviewed against current OWASP guidance.

### 20.2 Tokens

- short-lived access JWT;
- refresh token in HttpOnly cookie;
- Secure in production;
- SameSite Lax or Strict according to deployment;
- refresh token stored only as a hash;
- rotation on every refresh;
- reuse detection revokes the token family;
- logout and logout-all supported.

### 20.3 API security

- Zod validation for all inputs;
- Helmet;
- explicit CORS origin;
- request-size limits;
- structured error responses;
- rate limiting for auth and expensive endpoints;
- quotas for generation/discovery;
- no raw SQL with untrusted interpolation;
- ownership checks at service layer;
- secrets only through environment/secret manager.

### 20.4 Upload security

`FileStorageProvider` validates:

- MIME type and extension;
- maximum size;
- generated storage key;
- no user-supplied path;
- image decoding where feasible;
- persistent volume locally and S3/GCS adapter later.

### 20.5 Financial-language controls

Investor generation uses:

1. system instructions forbidding direct trade advice and numeric targets;
2. a schema requiring caveats and uncertainty;
3. deterministic prohibited-pattern checks;
4. optional classification pass;
5. flagged output withheld or visibly unavailable pending review.

Simple keyword matching is defense-in-depth, not the sole control.

---

## 21. Frontend Architecture and UX

### 21.1 Technology

- React + TypeScript + Vite;
- React Router;
- TanStack Query for server state;
- Zod-compatible generated/shared contracts;
- Tailwind CSS or Bootstrap according to team preference;
- Cytoscape.js for graph visualization.

### 21.2 Pages

Public:

- Login;
- Register;
- Unauthorized/Not Found.

Student/Investor:

- role dashboard;
- search/discovery;
- Story list;
- Story detail;
- Timeline view;
- claims/evidence view;
- entity graph view;
- My Briefs;
- Brief detail/comparison.

Admin:

- operations overview;
- Publishers/connectors;
- ingestion runs;
- clustering review;
- Story merge/split;
- generation runs;
- prompt versions;
- evaluation dashboard;
- entity/relation review;
- system configuration.

### 21.3 Core components

- `StatusStepper` tied to GenerationRun statuses;
- `EvidenceChip` and citation drawer;
- `ClaimCard` with support/contradiction badges;
- `CoverageModeBanner`;
- `TimelineView`;
- `StorySourceDistribution`;
- `EntityGraph`;
- `BriefCard`;
- `ChangeComparison`;
- `QuotaBanner`;
- `OperationalHealthCard`.

### 21.4 UX state requirements

Every data-fetching page handles:

- loading;
- empty;
- partial/stale data;
- background refresh;
- validation failure;
- generation flagged;
- unauthorized;
- not found;
- upstream connector failure.

Do not hide failure behind endless spinners.

---

## 22. Observability and AI Evaluation

### 22.1 Structured logging

Every request/job log includes:

- request/job ID;
- user ID when applicable;
- connector/run ID;
- Story ID;
- GenerationRun ID;
- duration;
- result status;
- error code without secrets.

### 22.2 Operational metrics

Ingestion:

- connector success/failure rate;
- discovered/inserted/duplicate/policy-rejected counts;
- average connector latency;
- stale connector count.

Queues:

- waiting/active/failed/completed counts;
- oldest waiting job;
- retry rate;
- processing latency.

Intelligence:

- generation success rate;
- escalation rate;
- citation-validation failure rate;
- unsupported-claim rate;
- flagged Investor output rate;
- average latency/token cost.

Data quality:

- pending clustering reviews;
- false-merge corrections;
- unresolved entities;
- relation review count;
- Stories with fewer than two Publishers.

### 22.3 Evaluation suite

Create a repeatable internal evaluation set for:

- schema validity;
- citation ID validity;
- claim evidence coverage;
- unsupported claim detection;
- timeline ordering;
- relation evidence;
- prohibited financial language;
- clustering quality;
- latency and cost.

Run evaluations:

- before activating a PromptVersion;
- before changing the default model;
- after major schema changes;
- as part of CI for deterministic/mocked cases.

Optional: mirror selected cases to OpenAI Evals tooling, but keep core evaluation records inside Tessera.

---

## 23. Non-Functional Requirements

### 23.1 Initial targets

These are engineering targets, not claims of proven global scale.

- Local cached Story response: under 500 ms under normal development load.
- Search response: under 1 second for course-scale data.
- Generation status update visible within 1–2 seconds of job transition.
- No unsupported claim is displayed after backend validation.
- No graph relation is displayed without RelationEvidence.
- Pipeline survives worker restart without duplicate authoritative records.
- Baseline application operates with Neo4j disabled.

### 23.2 Freshness

- RSS/tracked-topic connectors: configurable, typically 15–60 minutes.
- GDELT tracked-topic discovery: configurable and quota-aware.
- Story synthesis is debounced and triggered by material evidence change, not every Article insertion.

### 23.3 Cost controls

- bounded Evidence Sets;
- content-hash caching;
- no regeneration when evidence and PromptVersion are unchanged;
- Luna/cheap model for bulk extraction;
- Terra for synthesis;
- Sol only for deterministic escalation;
- optional Batch API for non-interactive backfills;
- per-role quotas and Admin budget limits.

---

## 24. Testing Strategy

### 24.1 Unit tests

- URL normalization;
- hashing and dedup candidates;
- clustering score components;
- quota calculation;
- evidence selection;
- citation validation;
- prohibited-language validator;
- timeline comparison;
- entity alias normalization.

### 24.2 Integration tests

Use disposable PostgreSQL/Redis services:

- registration/login/refresh rotation/reuse detection;
- RBAC per route class;
- ownership isolation;
- TypeORM migrations from empty database;
- Publisher rights enforcement;
- connector normalization;
- Story assignment transaction;
- Brief capacity enforcement;
- Generation persistence;
- claim/evidence referential integrity;
- relation/evidence integrity;
- keyset pagination.

### 24.3 Contract tests

- RSS adapter fixtures;
- GDELT adapter fixture responses;
- OpenAI-compatible provider mocked payloads;
- strict structured schema failures;
- refusal handling.

### 24.4 End-to-end tests

Critical journeys:

1. Student registers, searches, opens Story, saves Brief.
2. Investor views implication lens and no prohibited advice appears.
3. Admin rejects incorrect Story assignment.
4. A cited claim opens the correct Article.
5. A frozen Brief displays a newer-analysis-available state.
6. Entity graph shows co-occurrence edges with source articles.

### 24.5 Golden datasets

Maintain deterministic fixtures for:

- 8–12 multi-source Stories;
- clustering pair labels;
- expected timeline nodes;
- expected claims and evidence;
- expected entities/relations;
- prohibited Investor outputs.

The final demonstration must not depend solely on live feeds.

---

## 25. Local Development and CI

### 25.1 Docker Compose services

Baseline:

- postgres (`pgvector/pgvector` image);
- redis;
- api;
- worker;
- web;
- tei (bge-m3 embedding service, ADR-0017).

### 25.2 Health endpoints

- `/health/live` for process health;
- `/health/ready` for database/Redis readiness;
- worker heartbeat stored in Redis or PostgreSQL;
- connector health shown in Admin UI.

### 25.3 CI checks

- formatting/lint;
- TypeScript type check;
- unit tests;
- integration tests;
- migration test from empty database;
- build API/worker/web;
- dependency/security audit;
- deterministic evaluation smoke suite.

---

## 26. Eight-Week Build Plan

### Week 1 — Platform foundation (P0)

Build:

- monorepo and shared packages;
- Docker Compose baseline;
- TypeORM data source and migrations;
- PostgreSQL/pgvector and Redis;
- User and RefreshSession;
- Argon2id, JWT access token, refresh rotation/reuse detection;
- RBAC/ownership middleware;
- API/worker separation;
- CI and test harness;
- Admin seed command.

Exit criteria:

- fresh clone starts locally;
- migrations create database;
- all auth/RBAC tests pass;
- API and worker are separate processes.

### Week 2 — Multi-source ingestion (P0/P1)

Build:

- Publisher and IngestionConnector;
- rights policy fields;
- IngestionRun;
- RSS adapter;
- GDELT DOC adapter;
- connector Job Schedulers;
- URL normalization, exact dedup, title hash;
- Article and initial Admin connector UI.

Exit criteria:

- RSS and GDELT both insert normalized Articles;
- duplicates are handled idempotently;
- rights-policy tests pass;
- connector failures are observable.

### Week 3 — Search and Stories (P0/P1)

Build:

- ArticleEmbedding;
- hybrid full-text/semantic search;
- Story and StoryArticle;
- clustering baseline and configurable thresholds;
- Admin pending-review queue;
- move/merge/split operations;
- Story list/detail UI;
- labelled clustering evaluation fixture.

Exit criteria:

- Articles form reviewable Stories;
- false assignments can be corrected without destructive edits;
- search/filter/pagination work;
- clustering metrics are reported.

### Week 4 — Evidence-grounded intelligence (P1)

Build:

- PromptVersion;
- EvidenceSet and EvidenceSetArticle;
- GenerationRun statuses;
- OpenAI provider + deterministic mock provider;
- Responses API Structured Outputs;
- AnalysisClaim and ClaimEvidence;
- backend validation and deterministic escalation;
- Student/Investor lens schemas;
- IntelligenceBrief and cover image/capacity.

Exit criteria:

- every displayed factual claim has valid evidence;
- generation is reproducible from frozen input;
- Student and Investor outputs are role-separated;
- Brief ownership/capacity tests pass.

### Week 5 — Timeline and Phase 3.5 graph (P1)

> **ADR-0011/0020 cut tracked topics and notifications from the graded build.** Week 5 is
> now the timeline read view + the knowledge graph entity resolution, not monitoring/alerting.

Build:

- Timeline read view: a Story's Articles + EvidenceSets ordered over time;
- GKG tone/volume overlays on the timeline;
- frozen Brief "newer-analysis-available" comparison;
- Entity, EntityAlias, EntityEdge (co-occurrence) tables (ADR-0019);
- entity resolution: normalization + confidence threshold + Admin review queue;
- bounded Cytoscape graph scoped to Story/Brief (50–200 nodes max);
- Admin entity merge/split review.

> **Original plan (retained for reference):** Week 5 originally included TimelineNode
> generation, "what changed" comparison, tracked topics, topic schedulers, and Notification
> entity + UI. These were cut by ADR-0011 (monitoring deferred) and superseded by ADR-0020
> (timeline as read view, not generated entity).

Exit criteria:

- at least five seeded/live Stories show meaningful timeline evolution;
- entity graph renders a clean bounded view for seeded Stories;
- ambiguous merges are reviewable;
- uncited edges cannot exist.

### Week 6 — Entity intelligence (P1)

> **ADR-0019 defers typed relations (RelationAssertion/RelationEvidence) post-course.**
> Edges are co-occurrence only, each carrying its `source_article_id`.

Build:

- Entity, EntityAlias, EntityEdge (co-occurrence) tables (continuing from Week 5);
- entity extraction from GKG surface-name strings (ADR-0018);
- entity resolution: normalization + confidence threshold;
- Admin entity merge/split review queue;
- entity profile API/page;
- evidence-backed entity context.

> **Original plan (retained for reference):** Week 6 originally included a controlled
> relation vocabulary, RelationAssertion, and RelationEvidence. ADR-0019 defers typed
> relations post-course because GKG doesn't provide them and they require a separate
> LLM extraction pipeline.

Exit criteria:

- graph facts are traceable to Articles;
- ambiguous merges are reviewable;
- uncited edges cannot exist.

### Week 7 — Graph exploration and operations (P1/P2)

> **ADR-0019 defers Neo4j post-course.** The graph ships entirely in PostgreSQL tables
> with recursive CTEs. No Neo4j in the graded build.

Build:

- bounded graph API (PostgreSQL recursive CTEs);
- Cytoscape.js visualization with force-directed layout;
- time/confidence/co-occurrence filters;
- operations dashboard for queues/ingestion/generation/data quality;
- near-duplicate SimHash/MinHash enhancement (if time permits).

> **Original plan (retained for reference):** Week 7 originally included optional Neo4j
> projection and parity tests. ADR-0019 supersedes this: the graph is Postgres-only.
> Neo4j remains a post-course option (see §31 Explicit Deferrals).

Exit criteria:

- users can explore an evidence-backed entity neighborhood (bounded to 50–200 nodes);
- Admin sees meaningful operational metrics.

### Week 8 — Evaluation, hardening, and submission (P0/P1)

Build:

- EvaluationCase and EvaluationRun;
- prompt/model comparison dashboard;
- complete quota/UsageEvent reporting;
- security review;
- performance profiling;
- retry/idempotency testing;
- accessibility and UX review;
- README, ER diagram, architecture diagram, API docs;
- Project Confirmation Report;
- final demo script and seeded data;
- backup/restore instructions.

Feature cutoff:

- no new major feature after approximately Day 50;
- remaining time is for defects, documentation, evaluation, and rehearsal.

Exit criteria:

- clean deployment from fresh clone;
- full automated test suite passes;
- evaluation suite meets documented thresholds;
- five-minute and fifteen-minute demos are rehearsed;
- every course requirement is traceable to code and a demo step.

---

## 27. Acceptance Criteria

### 27.1 P0 acceptance

- Mandatory technology stack used correctly.
- Migrations work from an empty database.
- JWT, refresh rotation, RBAC, and ownership are tested.
- Three dashboards are visibly and functionally different.
- IntelligenceBrief satisfies every required core-entity field.
- Search, filters, sorting, and pagination work.
- Upload, capacity, validation, not-found, unauthorized, and error states work.
- Local Docker Compose demonstration is reliable.

### 27.2 Intelligence acceptance

- Every factual claim contains at least one valid supporting citation.
- Evidence IDs outside the Evidence Set are rejected.
- Comparative analysis requires at least two distinct Publishers.
- Timeline Nodes have evidence and valid chronological ordering.
- Investor output passes prohibited-language validation.
- Generation input can be reconstructed from EvidenceSetArticle snapshots.

### 27.3 Graph acceptance

- Every displayed edge has its `source_article_id` (ADR-0019) — uncited edges are bugs.
- Entity merges are conservative and reviewable.
- Graph endpoints enforce node/edge caps (50–200 nodes max) and depth limits.
- PostgreSQL graph implementation works independently (no Neo4j required).

### 27.4 Quality acceptance

- Clustering fixture has measured results.
- Evaluation suite runs repeatably.
- Prompt/model changes are not activated without evaluation results.
- Operational failures are visible in Admin UI.

---

## 28. Demonstration Plan

### 28.1 Five-minute course demo

1. Start from a clean local deployment.
2. Log in as Student and show role-specific dashboard.
3. Search/filter Stories.
4. Open a Story with multiple Publishers.
5. Show claims and expandable evidence.
6. Show timeline (Articles + EvidenceSets ordered over time).
7. Save an IntelligenceBrief with cover image and capacity rule.
8. Attempt an unauthorized Investor/Admin action to demonstrate API RBAC.
9. Switch to Investor and show implication lens and caveats.
10. Switch to Admin and show connector health, pending review, and a generation run.

### 28.2 Extended technical demo

Add:

- RSS/GDELT connector run;
- Article deduplication;
- Story assignment review;
- GenerationRun status stepper;
- frozen Evidence Set;
- entity relation and source evidence;
- evaluation comparison;
- knowledge graph: entity resolution, co-occurrence edges, bounded Cytoscape view.

---

## 29. Viva-Ready Architecture Answers

### Why not Kafka?

BullMQ already separates API producers and workers, supports scheduling, retries, status, and horizontal worker scaling with far lower operational burden. Kafka becomes justified when event throughput, replay, cross-service distribution, or independent consumer ecosystems exceed Redis queue needs.

### Why not a separate vector database?

pgvector keeps relational metadata and embeddings together, supports exact search and approximate indexes, and is sufficient for the expected scale. The search service is abstracted so a dedicated vector store can be introduced after benchmarking.

### Why not Neo4j (or why plain Postgres for the graph)?

> **ADR-0019 supersedes the original Neo4j plan.** The knowledge graph ships in plain
> PostgreSQL tables traversed with recursive CTEs. Neo4j is explicitly deferred post-course.

PostgreSQL owns graph facts and evidence. The entity graph is bounded (~50–200 nodes per Story)
and co-occurrence edges are simple enough that recursive CTEs perform well at this scale.
Neo4j would add an operational dependency (a second database to keep in sync) for marginal
query benefit on a bounded graph. It remains an optional post-course projection if the
graph grows beyond what Postgres handles comfortably.

### How does the project scale?

API, workers, PostgreSQL, Redis, file storage, and provider adapters are separated by process or interface. Initial deployment is small, but API and worker replicas can scale independently; managed Postgres/Redis/object storage can replace local containers; individual connectors and processing queues can be split without changing domain entities.

### How do you prevent hallucinated citations?

The model may only cite backend-issued evidence IDs. The backend validates every ID against the frozen Evidence Set and rejects claims, timeline nodes, or relations that lack valid evidence.

### How do you know AI quality improved?

Prompt/model configurations are evaluated against repeatable Evaluation Cases measuring schema validity, citation validity, claim support, timeline order, prohibited content, latency, and cost.

### Why is the core entity IntelligenceBrief rather than Story?

Story is shared global knowledge and has no natural user owner. IntelligenceBrief is the user-owned analytical artifact and naturally contains title, description, timestamp, category, capacity, media, ownership, and a frozen generation.

---

## 30. Startup Roadmap After the Course

### Phase A — Deployment and real users

- managed PostgreSQL/Redis;
- S3/GCS storage;
- production monitoring;
- email notifications;
- paid Investor tier;
- source licensing review;
- public correction/takedown workflow.

### Phase B — Broader ingestion

- additional publisher APIs;
- GDELT BigQuery aggregate research connector;
- language-specific pipelines;
- improved near-duplicate families;
- source reliability/coverage metadata.

### Phase C — Advanced intelligence

- better entity resolution;
- relation temporal validity;
- story re-clustering;
- alert rules;
- enterprise workspaces;
- exports and API access;
- richer evaluation datasets.

### Phase D — Public distribution

- public, crawlable Story/entity pages;
- SSR frontend or dedicated public surface;
- CDN and edge caching;
- editorial correction workflows;
- licensing partnerships.

### Phase E — Infrastructure evolution

Introduce Kafka, specialized vector/search infrastructure, or independent services only in response to measured scale or organizational boundaries—not as speculative architecture.

---

## 31. Explicit Deferrals

The following are deliberately excluded from the eight-week commitment:

- unrestricted full-web scraping;
- global raw GDELT mirroring;
- Common Crawl backfill;
- perfect multilingual entity resolution;
- fully autonomous relation publication;
- trading recommendations;
- personalization/recommendation engine;
- native mobile clients;
- payment gateway implementation;
- Kubernetes;
- global 100,000-article/day claims without load tests.

**Additional deferrals per ADRs 0013–0022:**

- **Neo4j / Apache AGE** — the graph ships in plain PostgreSQL tables with recursive CTEs; a dedicated graph store is an optional later projection (ADR-0019).
- **Typed entity relations** (acquired / sued / partnered) — GKG doesn't provide them; requires a separate LLM extraction pipeline. Highest moat value, highest risk (ADR-0019).
- **Broad cross-Story firehose graph** — rejected for the "noisy duplicate nodes" demo risk; the graph is bounded/curated (~50–200 nodes, scoped to the Story in view) (ADR-0019).
- **TrackedTopic / Notification / change-detection** — monitoring mini-product (alert on what changed) is cut from graded build. The Timeline *view* (showing evolution) still ships (ADR-0011, ADR-0020).
- **Refresh-token rotation** — deferred security hardening; plain JWT access token ships (ADR-0013).
- **Generated Timeline Nodes** — the timeline is a read view over existing Articles ordered by time; generated nodes are optional materialization only if queries prove too slow (ADR-0020).

These are not forgotten. Their required interfaces and additive data-model paths are documented.

---

## 32. AI-Assisted Development Workflow

AI coding increases implementation speed, but does not eliminate integration and quality risks.

### 32.1 Work-unit rule

Each task given to a coding agent must include:

- exact scope;
- affected modules;
- relevant entities/contracts;
- acceptance criteria;
- tests to add/run;
- explicit out-of-scope items.

### 32.2 Branch/task sequence

1. read this specification and relevant ADR;
2. propose file-level plan;
3. implement one bounded task;
4. generate/update tests;
5. run lint/typecheck/tests;
6. inspect migration/API changes;
7. review diff manually;
8. merge only after acceptance criteria pass.

### 32.3 Guardrails for coding agents

- Do not use `synchronize: true`.
- Do not add a new framework without an ADR.
- Do not call provider SDKs outside provider adapters.
- Do not start workers in the API process.
- Do not bypass RBAC/ownership in tests or seed logic.
- Do not write unvalidated model JSON directly to user-facing tables.
- Do not claim full-article omissions from feed excerpts.
- Do not hardcode model IDs, thresholds, quotas, or secrets in services.
- Do not build TrackedTopic, Notification, or typed relation features (ADR-0011, ADR-0019, ADR-0020).

### 32.4 Definition of done

A task is complete only when:

- implementation is present;
- tests pass;
- failure states are handled;
- migrations are reviewed;
- API contracts are updated;
- documentation/config examples are updated;
- no unrelated architecture drift was introduced.

---

## 33. Initial Configuration Defaults

Defaults are starting points and must be calibrated.

| Config | Initial value |
|---|---:|
| Evidence max Articles | 10 |
| Evidence max per Publisher | 2 |
| Minimum Publishers for comparison | 2 |
| Story candidate time window | 7 days |
| Auto-assignment threshold | Experimental; calibrate with fixture |
| Suggestion threshold | Experimental; calibrate with fixture |
| Dormant Story age | 4–7 days depending on category |
| Student daily generation quota | 5 |
| Investor daily generation quota | 20 |
| Graph default depth | 1 |
| Graph maximum depth | 2 |
| Graph default node cap | 50 |
| Cover image maximum | 2 MB |

No threshold should be defended as universal before project-specific evaluation.

---

## 34. Open Decisions Before Coding

1. Final first-wave RSS publishers and their rights fields.
2. ~~Initial GDELT tracked-topic queries.~~ **Resolved by ADR-0018:** GKG 15-min firehose is the backbone; no tracked-topic queries needed.
3. ~~Whether the optional Neo4j profile will run locally from Week 7 or only in a separate demo profile.~~ **Resolved by ADR-0019:** Neo4j deferred post-course; graph ships in plain Postgres.
4. Exact file-storage local path and future object-storage provider.
5. Tailwind CSS versus Bootstrap.
6. Initial OpenAI API budget and access to configured models.
7. Evaluation thresholds for claim support and clustering false merges.
8. Whether Investor registration remains self-selectable or Admin-approved during the course build.

None of these changes the core architecture.

---

## 35. Verified Technology Notes and References

The following current, primary references informed this specification:

1. **GDELT DOC 2.0 API** — Article List output supports JSON and related export formats; GDELT is suitable for discovery rather than assuming article-content rights.  
   [GDELT DOC 2.0 API Debuts](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)  
   [GDELT DOC 2.0 JSONFeed](https://blog.gdeltproject.org/gdelt-doc-2-0-api-supports-jsonfeed/)

2. **GDELT data scale and update model** — GDELT datasets are available through BigQuery and are updated at high frequency; raw GKG-scale data is too large for casual local mirroring.  
   [GDELT Data](https://www.gdeltproject.org/data.html)  
   [GDELT 2.0 in Realtime](https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/)

3. **BullMQ Job Schedulers** — Job Schedulers replace the older repeatable-job APIs from BullMQ 5.16 onward.  
   [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers)  
   [BullMQ Repeatable Jobs Deprecation](https://docs.bullmq.io/guide/jobs/repeatable)

4. **TypeORM and pgvector** — TypeORM supports PostgreSQL vector columns and similarity operators through pgvector.  
   [TypeORM Entities — Vector Columns](https://typeorm.io/docs/entity/entities/)  
   [TypeORM PostgreSQL Driver](https://typeorm.io/docs/drivers/postgres/)

5. **pgvector indexing** — exact nearest-neighbor search is the default; HNSW and IVFFlat trade some recall for speed.  
   [pgvector README](https://github.com/pgvector/pgvector/blob/master/README.md)

6. **OpenAI Responses API and Structured Outputs** — Responses is the recommended direct-generation interface; Structured Outputs constrains responses to supplied JSON Schema. **ADR-0003 supersedes the original mandate:** the SynthesisProvider interface accepts any OpenAI-compatible endpoint, not just the Responses API.  
   [Responses API Migration](https://developers.openai.com/api/docs/guides/migrate-to-responses)  
   [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

7. **OpenAI models** — current model selection guidance identifies Sol for flagship capability, Terra for balance, and Luna for cost-sensitive high-volume workloads; model IDs remain configuration. **ADR-0003 supersedes:** no model ID is hardcoded; the provider and model are chosen by environment variable.  
   [OpenAI Models](https://developers.openai.com/api/docs/models)  
   [Model Guidance](https://developers.openai.com/api/docs/guides/latest-model)

8. **Embeddings** — `bge-m3` (BAAI, MIT) served via TEI at `vector(1024)` is the default embedding model (ADR-0017). The original `text-embedding-3-small` at `vector(384)` is superseded. Cheap-API fallbacks: `voyage-3.5-lite` or `gemini-embedding-001`, both truncating to 1024 dims.
   [bge-m3 HuggingFace](https://huggingface.co/BAAI/bge-m3)
   [pgvector README](https://github.com/pgvector/pgvector/blob/master/README.md)

9. **Evals** — repeatable evaluations are an essential component of reliable model/prompt changes.  
   [OpenAI Evals Guide](https://developers.openai.com/api/docs/guides/evals)

10. **Neo4j knowledge-graph pipeline complexity** — knowledge-graph construction requires entity/relation extraction, graph writing, and entity resolution; the current Neo4j builder is marked experimental, reinforcing the decision to keep PostgreSQL authoritative. **ADR-0019 defers Neo4j post-course; the graph ships in plain PostgreSQL tables.**  
    [Neo4j Knowledge Graph Builder](https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_kg_builder.html)  
    [Neo4j Data Modeling Tutorial](https://neo4j.com/docs/getting-started/data-modeling/tutorial-data-modeling/)

---

# Final Build Statement

The target is not “the largest architecture possible in eight weeks.” The target is the strongest coherent product that can be implemented, tested, explained, and continued.

Tessera v3 therefore commits to:

- a course-compliant modular platform;
- RSS and GDELT discovery;
- correctable semantic Story clustering;
- frozen evidence and claim-level provenance;
- a timeline read view showing Story evolution (ADR-0020);
- owned Intelligence Briefs;
- Student and Investor lenses with role-distinct features (ADR-0021);
- a bounded, cited entity graph in PostgreSQL (ADR-0019);
- prompt/version evaluations;
- production-shaped security, migrations, queues, and observability.

This is a credible first release of the actual Tessera product—not a temporary demo and not an unfinishable production fantasy.
