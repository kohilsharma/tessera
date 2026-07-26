# 4. Three roles must be genuinely distinct (widen Student vs Investor)

Date: 2026-07-25
Status: Accepted

## Context

The course requires ≥3 roles with "clearly defined responsibilities" and dashboards where
"access and data visibility must still differ". In v3 §4.2, Student and Investor share every
capability (search, view consensus, create Briefs, track topics, notifications, upload
image) and differ only by which analytical lens they see. A strict grader could read them as
one role with a template switch — risking a guaranteed rubric line.

## Decision

Keep Admin / Student / Investor, but **widen Student vs Investor into genuinely different
permission sets, endpoints, and dashboards**:

- **Student**: study collections, guided-reading flow, citation export, learning/context lens.
- **Investor**: watchlist/sectors, sector-filtered dashboard, Investor-only implication
  briefs, implication lens (with prohibited-financial-language controls).
- **Admin**: connectors, clustering review, generation inspection. Never owns user Briefs.

Each role gets endpoints and data the others cannot access — not just a display flag.

## Consequences

- Converts a rubric risk into a rubric strength (clear RBAC + ownership demo).
- Slightly more backend surface (role-specific endpoints), but this is core-required work.
