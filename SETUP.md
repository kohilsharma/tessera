# SETUP

Local demo path for Tessera. Stateful dependencies run in Docker Compose; the API and
frontend run natively (ADR-0015).

## Prerequisites

- Node.js 22+, npm 10+
- Docker + Docker Compose
- Your user must be able to run `docker` without `sudo` (member of the `docker` group).
  If `docker ps` fails with a permission error: `sudo usermod -aG docker $USER`, then log
  out and back in (or start a new shell) for the group change to take effect.

## 1. Start stateful dependencies

```bash
docker compose up -d
```

Starts Postgres (with the `vector` extension available) on `5433` and Redis on `6380` —
offset from the defaults to avoid clashing with other services you may already have
running locally.

## 2. Backend

```bash
cd backend
npm install
cp .env.example .env
npm run migrate   # applies migrations, incl. `CREATE EXTENSION vector`
npm run seed      # demo users for all three roles (ADR-0015) + a Story/Article corpus
npm run dev       # http://localhost:4000
npm run build     # type-check + compile to dist/ (`npm start` runs the build)
```

### Demo logins

`npm run seed` is idempotent — re-run it after any migration. It creates one user
per role, all sharing the same password, plus a Publisher/Story/Article corpus
(browsable at `/stories` once the frontend is running) embedded with the deterministic
Mock EmbeddingProvider (ADR-0003).

| Email | Role |
|---|---|
| `student@tessera.local` | Student |
| `investor@tessera.local` | Investor |
| `admin@tessera.local` | Admin |

Password: `tessera-demo`, or whatever `SEED_PASSWORD` is set to when you run it.

**Seeding is the only way an Admin exists.** `POST /auth/register` accepts Student
and Investor only — Admin is assigned, never self-served (ADR-0004) — so without
this step `/dashboard/admin` has no one who can reach it.

`.env` must set `JWT_SECRET` to a long random string — there is no built-in
fallback, so the API refuses to sign or verify a token without it (ADR-0013).
Changing it invalidates every token already issued, which just means logging in
again. Generate one with `openssl rand -hex 32`.

`GET http://localhost:4000/api/v1/health` should return `{"status":"ok","db":"ok",...}`.

## 3. Frontend

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production bundle to dist/
```

`/status` shows the health check fetched live from the API (proxied via Vite's dev
server — see `frontend/vite.config.ts`). `/` shows the design-prototype UI.

## Tests

Backend tests drive the Express app with `supertest` against a real, ephemeral
Postgres spun up per test run via Testcontainers — no manual test-DB setup needed,
just a working `docker` connection (see Prerequisites).

```bash
cd backend
npm test
```

There is no frontend test script yet — `npm run build` is the only frontend check.
