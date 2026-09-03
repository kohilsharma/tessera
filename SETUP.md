# Setup

How to get Tessera running locally. Postgres and Redis go in Docker; the API and the frontend run
natively on your machine (ADR-0015).

## Before you start

You need Node 22 or newer, npm 10+, and Docker with Compose.

Your user also has to be able to run `docker` without `sudo`. If `docker ps` comes back with a
permission error, add yourself to the group and start a fresh shell:

```bash
sudo usermod -aG docker $USER
```

Log out and back in if a new shell isn't enough. This matters for the test suite too, not just for
Compose, because the backend tests spin up their own Postgres container.

## 1. Dependencies

```bash
docker compose up -d
```

Postgres comes up on **5433** with the `vector` extension available, Redis on **6380**. Both are
shifted off the standard ports (5432 and 6379) so they don't collide with anything you already have
running locally.

## 2. Backend

```bash
cd backend
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run dev            # http://localhost:4000
```

`npm run migrate` is also what runs `CREATE EXTENSION vector`, so it has to happen before anything
tries to embed. `npm run build` type-checks and compiles to `dist/`, and `npm start` runs that
build.

Before `npm run dev` will do anything useful you have to set `JWT_SECRET` in `.env` to a long random
string. There's no built-in fallback, so the API refuses to sign or verify a token without one
(ADR-0013). `openssl rand -hex 32` is fine. Changing it later invalidates every token already
issued, which in practice just means logging in again.

`UPLOADS_DIR` is where Brief cover images get written. It defaults to `backend/uploads/`, is created
on first upload, and is gitignored. Point it somewhere real if you want uploads to survive a
container rebuild.

Quick check that it's alive:

```bash
curl http://localhost:4000/api/v1/health
# {"status":"ok","db":"ok",...}
```

### Demo logins

`npm run seed` is idempotent, so re-run it after any migration. It creates one user per role, a
Publisher/Story/Article corpus you can browse at `/stories`, the IngestionConnectors the Admin
dashboard inspects (10 curated RSS feeds plus the GKG firehose), and one Brief already owned by the
Student user with articles and a cover image attached, so there's something populated at `/briefs`
without having to build one live during a demo.

| Email | Role |
|---|---|
| `student@tessera.local` | Student |
| `investor@tessera.local` | Investor |
| `admin@tessera.local` | Admin |

The password is `tessera-demo`, or whatever you set `SEED_PASSWORD` to when you ran it.

**Seeding is the only way an Admin exists.** `POST /auth/register` will only ever make a Student or
an Investor, because Admin is assigned rather than self-served (ADR-0004). Skip this step and
`/dashboard/admin` is a page that nobody on the system can open.

## 3. Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
npm run build          # type-check plus a production bundle in dist/
```

`/` sends you to your own role dashboard, or to `/login` if you're signed out. `/status` shows the
health check fetched live from the API, proxied through Vite's dev server (see
`frontend/vite.config.ts`).

## The worker

Ingestion, clustering and entity resolution run in a process of their own, natively rather than in
Compose (ADR-0015). Give it a second terminal:

```bash
cd backend
npm run worker         # tsx watch; npm run start:worker runs the compiled build
```

It drains three queues on a schedule. Every quarter hour it queues one `ingestion` run per enabled
connector, at :05 past the hour one `clustering` run over the whole corpus, and at :20 one `graph`
resolution pass over the retained annotations.

Every Admin command does the same thing — the Run button on a connector row, Run clustering on its
register, Run resolution on the graph one. They all enqueue rather than executing anything
themselves, so the scheduled path and the on-demand path are one path, and what you demo is what
actually runs in production. Press any of them with the worker stopped and the work simply waits
until it comes back up.

Nothing else depends on the worker. Run history is read from Postgres rather than from the queue,
so `/dashboard/admin` renders perfectly well with it down. `REDIS_URL` does have to be set for
either the worker or the Run buttons to do anything, and it's already in `.env.example`.

A tick works the enabled fleet one connector at a time, and the GKG firehose alone is around 700
rows per 15-minute window, so expect roughly a minute of work per tick and a corpus that grows
steadily while the worker is up.

What arrives is all **Unclustered Articles**, invisible to browse and search, and it stays that way
until the clustering pass places it. Most firehose rows never leave that state, on purpose: only
articles carrying text are eligible (`feed_excerpt` or above, which means RSS and Readability but
not GKG or DOC), and a Story is only seeded where two Publishers corroborate each other. So a first
hour of ingestion may well cluster nothing at all. That's expected, not a fault. The thresholds are
env-overridable and the defaults are documented in `.env.example`.

## Providers

### Embeddings

`EMBEDDING_PROVIDER` picks between `gemini`, `openai` and `mock`. Leave it unset and the choice is
inferred from whichever key is configured; with no key at all you get the network-free Mock. Hosted
providers need `EMBEDDING_MODEL` set explicitly, so model ids stay deployment configuration instead
of turning into code defaults.

Gemini goes through Google AI Studio's synchronous batch endpoint and maps Tessera's `query` and
`passage` kinds onto retrieval task types. An OpenAI-compatible endpoint additionally wants
`EMBEDDING_API_BASE`, and `EMBEDDING_INPUT_STYLE` chooses between local prefixes and the endpoint's
own `input_type` field. Both batch several texts per request.

**Switching embedding providers means re-embedding from scratch.** Search compares a query vector
against whatever embedded the corpus, and two providers' vector spaces have nothing to do with each
other, so mixing them returns nonsense quietly instead of failing loudly. Re-running the seed will
not save you: it's idempotent, skips Stories that already exist, and therefore re-embeds nothing.
Drop the data and rebuild:

```bash
docker compose down -v && docker compose up -d   # this discards the Postgres volume
cd backend && npm run migrate && npm run seed
```

If a hosted provider is unreachable or rate-limited at query time, search logs it and falls back to
lexical-only results rather than erroring, so a seeded demo stays usable when the network drops
(ADR-0023).

### Synthesis

Synthesis isn't enabled just because something speaks `/chat/completions`. Frozen evidence text may
only go to the paid provider that is contractually no-training (ADR-0003). Set `SYNTHESIS_API_KEY`,
`SYNTHESIS_MODEL` and `SYNTHESIS_API_BASE`, then set `SYNTHESIS_ALLOWED_ORIGIN` to that endpoint's
exact HTTPS origin. The backend checks for a mismatch and refuses before any evidence leaves the
process. With no key you get the deterministic Mock.

The same provider names each new Story, working only from its members' headlines — no article text
is sent for a naming call. Naming is the one non-deterministic step in clustering: re-running
reproduces membership exactly, but a comparable cluster can come out with a different title, and an
existing Story is never renamed. With no key, Stories come out as `[mock] <headline>`, which is the
demo admitting that no model named them.

## Tests

```bash
cd backend && npm test
```

The backend tests drive the Express app with `supertest` against a real, ephemeral Postgres that
Testcontainers spins up per run, so there's no test database to configure — just a working `docker`
connection (see the prerequisites above). Redis is deliberately left out of the test stack; the one
enqueue call is stubbed, so the suite only ever needs the Postgres container.

```bash
cd frontend
npm test
npm run build
```

The frontend tests are the secondary seam: Vitest, jsdom and React Testing Library over the
components that carry real state logic — the list and search views, the Brief create/edit form, the
auth flow — asserting the four UI states and form submission. No database and no running backend
needed, only a stubbed `fetch`.
