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
                  # + IngestionConnectors (10 curated RSS feeds + the GKG firehose) + one owned Brief
npm run dev       # http://localhost:4000
npm run build     # type-check + compile to dist/ (`npm start` runs the build)
```

### The worker

Ingestion and clustering run in their own process, natively rather than in Compose
(ADR-0015). Start it in a second terminal:

```bash
cd backend
npm run worker    # tsx watch src/worker.ts (`npm run start:worker` runs the build)
```

It drains two queues. On every quarter hour it enqueues one `ingestion` run for each enabled
connector; at five past every hour it enqueues one `clustering` run over the whole corpus. Both
Admin commands — the Run button on a connector row, and Run clustering on the register — enqueue
onto those same queues, so the scheduled path and the on-demand path are the same execution
path: pressing either with the worker stopped queues work that happens when the worker next
starts.

Nothing else needs the worker: run history is read from Postgres, so
`/dashboard/admin` renders correctly with the worker down. `REDIS_URL` must be set (it is
in `.env.example`) for either the worker or the Run buttons to work.

A tick runs the whole enabled fleet one connector at a time, and the GKG firehose alone is
~700 rows per 15-minute window, so expect a minute of work per tick and the corpus to grow
steadily while the worker is up. Everything it ingests arrives as an **Unclustered Article** —
invisible to browse and search — and stays that way until the clustering pass places it. Most
firehose rows never leave that state by design: only Articles carrying text (`feed_excerpt` or
above — RSS and Readability, not GKG or DOC) are eligible, and a Story is seeded only where two
Publishers corroborate each other, so a first hour of ingestion may cluster nothing. The
clustering thresholds are env-overridable with documented defaults (see `.env.example`).

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

The corpus and search queries use the provider selected by `EMBEDDING_PROVIDER`: `gemini`,
`openai`, or `mock`. Unset selection is inferred from the configured key; no key uses the
network-free Mock. Hosted providers require `EMBEDDING_MODEL`, so model IDs remain deployment
configuration rather than code defaults.

Gemini uses Google AI Studio's synchronous batch endpoint and maps Tessera's `query`/`passage`
kinds to retrieval task types. An OpenAI-compatible embedding endpoint additionally requires
`EMBEDDING_API_BASE`; `EMBEDDING_INPUT_STYLE` chooses local prefixes or the endpoint's
`input_type` field. Both paths batch multiple texts per request.

### Synthesis (ADR-0003)

Synthesis is not enabled merely because a service speaks `/chat/completions`. Frozen evidence
text may only go to the paid, contractually no-training provider. Set its
`SYNTHESIS_API_KEY`, `SYNTHESIS_MODEL`, and `SYNTHESIS_API_BASE`, then set
`SYNTHESIS_ALLOWED_ORIGIN` to that endpoint's exact HTTPS origin. The backend refuses a
mismatch before sending evidence. With no key, the deterministic Mock is used.

The same provider names each new Story (#51), from its members' headlines only — no article
text is sent for a naming call. Naming is the one non-deterministic step in clustering: a
re-run reproduces membership exactly, but a comparable cluster may be titled differently, and
an existing Story is never renamed. With no key, Stories are named `[mock] <headline>`, which
is how a demo without a key admits that no model named them.

**Switching embedding providers means re-embedding from scratch.** Search compares a query's
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
server — see `frontend/vite.config.ts`). `/` redirects to your own role dashboard
(or to `/login` when signed out). The Phase-3 design prototype lives at
`/design-prototype`.

## Tests

Backend tests drive the Express app with `supertest` against a real, ephemeral
Postgres spun up per test run via Testcontainers — no manual test-DB setup needed,
just a working `docker` connection (see Prerequisites). Redis is deliberately not in the
test stack: the one enqueue call is stubbed, so the suite needs only the Postgres
container.

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
