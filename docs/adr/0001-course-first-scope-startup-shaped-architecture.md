# 1. Course-first scope, startup-shaped architecture

Date: 2026-07-25
Status: Accepted

## Context

Tessera is both a graded course capstone (fixed 8-week deadline, solo developer,
AI-assisted) and the intended foundation for a real product. The v3 build spec
(`Tessera_Master_Build_Specification_v3.md`) describes ~30 entities, entity resolution,
a knowledge graph, optional Neo4j, an evaluation harness, tracked topics, notifications,
and timeline change-detection — realistically a multi-month build for a small team.

The course rewards architectural depth, clean RBAC, business logic, and a *complete,
defensible* local demo. It explicitly penalizes shallow/broad apps ("superficial
applications with minimal logic will receive low grades").

## Decision

Optimize for **course grade first, using startup-shaped seams**. Concretely:

- **Scope** is cut to what can be *fully finished and demoed* in 8 weeks solo.
- **Architecture** keeps v3's extensibility seams: provider interfaces
  (Synthesis/Embedding), separate API vs worker processes, frozen evidence sets,
  Postgres-authoritative data. Startup-only modules are deferred *behind interfaces*,
  not designed out.

This makes "startup foundation" an architecture decision, not a scope decision.

## Consequences

- Every graded feature must work end-to-end at demo time; no half-lit modules.
- Deferred modules (entity graph, Neo4j, eval harness, tracked topics, notifications,
  timeline diffing) must have documented interfaces/data-model paths so they can be added
  later without rework.
- Risk of an unfinished/broken demo is minimized; ceiling on "wow-factor breadth" is lower
  by choice.
