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
                  # + seed-only IngestionConnectors + one owned Brief
npm run dev       # http://localhost:4000
npm run build     # type-check + compile to dist/ (`npm start` runs the build)
```

### Demo logins

`npm run seed` is idempotent — re-run it after any migration. It creates one user
per role, all sharing the same password, a Publisher/Story/Article corpus (browsable
at `/stories` once the frontend is running), the IngestionConnectors the Admin
dashboard inspects, and one owned Brief for the Student user
with Articles and a cover image already attached (browsable at `/briefs`) — so the
demo has a populated Brief to show without building one live.

| Email | Role |
|---|---|
| `student@tessera.local` | Student |
| `investor@tessera.local` | Investor |
| `admin@tessera.local` | Admin |

Password: `tessera-demo`, or whatever `SEED_PASSWORD` is set to when you run it.

**Seeding is the only way an Admin exists.** `POST /auth/register` accepts Student
and Investor only — Admin is assigned, never self-served (ADR-0004) — so without
this step `/dashboard/admin` has no one who can reach it.

### Embeddings

The corpus and every search query are embedded with whichever `EmbeddingProvider`
`GEMINI_API_KEY` selects (ADR-0017/0023's interface):

- **Set — the intended configuration (ADR-0023):** the hosted
  `gemini-embedding-001` (Google AI Studio, free tier), truncated to
  `vector(1024)`. Get a free key at https://aistudio.google.com/apikey and put it
  in `.env`; `EMBEDDING_MODEL` overrides the model id and `EMBEDDING_API_BASE`
  the endpoint if needed (ADR-0003: no hardcoded model ids or hosts).
- **Unset — fallback:** the deterministic Mock provider. No network, no API key,
  works offline, and it is what every backend test uses (ADR-0003) — but its
  vectors carry no meaning, so the *semantic* half of hybrid search returns
  deterministic placeholders rather than real similarity. Lexical (Postgres FTS)
  results stay genuine either way. The API logs a warning on startup when it
  falls back, so a demo can't be running on it unnoticed.

**Switching providers means re-embedding from scratch.** Search compares a query's
vector against whatever embedded the corpus, and the two providers' vector spaces
are unrelated — mixing them silently returns nonsense rather than failing. A plain
re-run of `npm run seed` will *not* fix this: seeding is idempotent and skips
Stories that already exist, so it re-embeds nothing. Drop the data and rebuild:

```bash
docker compose down -v && docker compose up -d   # discards the Postgres volume
cd backend && npm run migrate && npm run seed
```

If the hosted provider is unreachable or rate-limited at query time, search logs
the failure and degrades to lexical-only results instead of erroring (ADR-0023:
the seeded demo stays usable when the network drops).

`.env` must set `JWT_SECRET` to a long random string — there is no built-in
fallback, so the API refuses to sign or verify a token without it (ADR-0013).
Changing it invalidates every token already issued, which just means logging in
again. Generate one with `openssl rand -hex 32`.

`UPLOADS_DIR` is where Brief cover images are written, defaulting to
`backend/uploads/` (ADR-0015: a local persistent volume for the demo). It is
created on first upload and gitignored; point it at a real volume to keep
uploads across a container rebuild.

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

Frontend tests are the secondary seam — Vitest + jsdom + React Testing Library over
the components carrying real state logic (the list and search views, the Brief
create/edit form, the auth flow), asserting the four UI states and form-submission
behaviour. No database or running backend needed; only `fetch` is stubbed.

```bash
cd frontend
npm test
npm run build     # type-check + production build
```
