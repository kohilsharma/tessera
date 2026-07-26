# 2. Flagship = frozen-evidence cited synthesis; entity graph deferred

Date: 2026-07-25
Status: Accepted — but the "entity graph deferred" half is **superseded by ADR-0019**
(the graph is un-deferred as a GKG-backed, bounded Phase-3.5 feature; the cited-synthesis
flagship decision below still stands).

## Context

v3 carries two candidate flagship differentiators competing for the same limited effort
budget: (A) frozen-evidence cited multi-source synthesis, and (B) an entity/relationship
knowledge graph with Cytoscape/Neo4j. Solo + 8 weeks + course-first scope (ADR-0001) can
finish exactly one to demo quality.

## Decision

Commit to **(A) frozen-evidence cited synthesis** as the finished flagship. Defer (B).

Flagship A pipeline: ingest → cluster into Stories → select + freeze EvidenceSet →
structured generation → **backend citation validation** → Student/Investor lenses →
owned IntelligenceBrief.

## Rationale

- (A) exercises every rubric line: real business logic, provenance, RBAC on generation,
  the owned core entity, search over results.
- (A) has a crisp viva answer to "how do you prevent hallucinated citations?" — the backend
  only accepts evidence IDs present in the frozen EvidenceSet.
- (B) entity resolution is a precision/recall minefield even for funded teams; a
  wrong-merge-riddled graph demos badly and is hard to defend. High risk, poor demo ROI.

## Consequences

- Entities may appear at most as a bounded, read-only "context" panel, if at all.
- Neo4j is not in the graded build.
- Entity/relation data-model paths remain documented for later addition.
