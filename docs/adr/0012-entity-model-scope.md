# 12. Entity model scope: ~17 core tables; IntelligenceBrief satisfies mandated fields

Date: 2026-07-25
Status: Accepted
Depends on: ADR-0002, 0004, 0006, 0010, 0011

## Context

Course requires ≥3 non-join entities and one owned core business entity with a specific
mandated field set (verified against project-statement.md §2). v3 had 30+ tables; after the
cuts (entity graph, timeline, monitoring) the graded build settles at ~17.

## Decision

Build these ~17 core tables (migrations written + maintained for each):

Identity/RBAC: `User`, `Role`
Acquisition: `Publisher`, `IngestionConnector`, `IngestionRun`
Content: `Article`, `Story`
Evidence/generation: `EvidenceSet`, `EvidenceSetArticle`, `GenerationRun`, `AnalysisClaim`,
`ClaimEvidence`, `PromptVersion`
Owned entity: `IntelligenceBrief`, `BriefArticle` (join)
Role-specific (ADR-0004): Investor `Watchlist`, Student `Collection`

Keep the Publisher/IngestionConnector split and PromptVersion as their own tables — both are
startup-right and consistent with full ingestion (ADR-0006). Not over-scoped: no table here
is dead weight given prior ADRs.

## Mandated-field check (project-statement §2 → IntelligenceBrief)

- Title/Name → `title`; Description → `note`; Timestamp → `createdAt`/`updatedAt`;
  Category → `category`; Capacity/Limit → `articleCapacityLimit` (enforced via BriefArticle
  count); Media → `coverImageKey`; Ownership → `ownerId` (Role A). All satisfied.

## Consequences

- `articleCapacityLimit` + `BriefArticle` is real business logic (bounded pinned-article
  set), not a token field — strong rubric/viva material.
- Deferred entities (Entity, RelationAssertion, TimelineNode, TrackedTopic, Notification)
  remain documented, unbuilt.
