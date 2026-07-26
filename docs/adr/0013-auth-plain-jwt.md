# 13. Auth: plain JWT (no refresh rotation); API-level RBAC

Date: 2026-07-25
Status: Accepted
Refines: v3 auth design; satisfies project-statement §1–§2, §5

## Context

The course mandates: JWT authentication, RBAC enforced **at the API level** (not just
frontend), password hashing, and graceful handling of unauthorized/invalid/not-found. v3
additionally specifies JWT access tokens **+ refresh-token rotation** (token table,
rotation, revocation, reuse-detection, frontend silent-refresh interceptor).

Refresh-token rotation is real surface area and a classic source of logout/refresh-loop
bugs, for **zero extra rubric marks** over plain JWT on a locally-demoed solo build.

## Decision

- **Single JWT access token**, short-ish expiry (e.g. 24h for local demo), sent as
  `Authorization: Bearer`. Logout = client drops the token.
- **Password hashing** with a strong KDF (Argon2id or bcrypt).
- **RBAC enforced in API middleware** (role guard per route + ownership checks), never
  frontend-only. Role-specific endpoints per ADR-0004.
- Consistent error contract: 401 unauthenticated, 403 unauthorized, 404 not-found, 422
  invalid input — backend validation + DB constraints (satisfies §5).
- Refresh-token rotation is documented as later security hardening; the auth interface is
  kept clean so it can be added without reworking callers.

## Consequences

- Rubric-complete auth with minimal surface; no refresh-loop debugging.
- Slightly less "production security posture" now — an accepted, documented trade-off.
