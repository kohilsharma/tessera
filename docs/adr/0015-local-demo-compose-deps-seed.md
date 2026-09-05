# 15. Local demo: Docker Compose for stateful deps + native app + seed script

Date: 2026-07-25
Status: Accepted
Depends on: ADR-0007 (fixtures), ADR-0005 (stack)
Satisfies: project-statement "all demos run on local machine"

## Context

The demo must run locally and reproducibly. The stack has ~6 moving parts: Postgres **with
pgvector**, Redis, Express API, BullMQ worker, a local embedding model, and the Vite
frontend. Two classic solo failure modes: "works on my machine" (pgvector/Node mismatch) and
"empty app" (no Stories to synthesize because ingestion hasn't populated data).

## Decision

- **Docker Compose for stateful deps only**: `pgvector/pgvector` Postgres image + Redis.
  This pins the one hard-to-install piece (pgvector) reproducibly.
- **API, worker, frontend run natively** via npm scripts (fast inner-loop iteration; no
  Dockerfile/hot-reload plumbing to maintain).
- **Seed script** (`npm run seed`) loads fixtures (ADR-0007) so the app is never empty:
  seeded users for all 3 roles, multi-source Stories, and at least one completed
  GenerationRun/Brief to demo instantly.
- **README.md**: prerequisites + exact commands (compose up → migrate → seed → run) and demo
  login credentials. One documented path from clone to working demo.

## Consequences

- pgvector reproducibility guaranteed regardless of examiner environment.
- Fast iteration retained (app not containerized).
- A full-containerization path remains possible later (add Dockerfiles) without rework.
- The seed script is demo-critical and must be maintained alongside schema migrations.
