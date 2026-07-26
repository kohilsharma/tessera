# 5. Vite + React SPA frontend; Node/Express backend (supersedes old-spec stack)

Date: 2026-07-25
Status: Accepted
Supersedes: the stack described in `ai-news-intelligence-spec.md` §10 and the old AGENTS.md

## Context

The original spec (`ai-news-intelligence-spec.md`) and the existing `AGENTS.md` bind the
project to Python/FastAPI, Kafka, Neo4j, and Next.js SSR — chosen for a public,
SEO-crawlable consumer site. The course, however, *mandates* Node.js/Express + TypeORM +
PostgreSQL + React, and the graded product is entirely auth-gated (nothing for crawlers to
see). A Python backend and Kafka are disallowed/unnecessary; SSR buys nothing behind a login.

Existing on disk: `backend/.venv/` (a Python virtualenv — dead scaffolding) and a Next.js
landing page.

## Decision

- **Backend**: Node.js + Express + TypeORM + PostgreSQL (course-mandated). Delete `backend/.venv`.
- **Frontend**: Vite + React SPA, React Router, TanStack Query (matches v3 §21).
- **No Kafka** — Redis + BullMQ only (v3 §0.4).
- **No SSR** for the graded app. The Next.js landing page may survive later as a standalone
  static marketing site, out of the graded build.

## Consequences

- `AGENTS.md` must be rewritten to bind to v3 + these ADRs (done alongside this ADR),
  or AI coding sessions will keep pulling toward the old stack.
- The Python `.venv` and any FastAPI scaffolding are removed.
- Loss of SEO on the app surface is acceptable and intended (auth-gated product).
