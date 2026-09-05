# Tessera

Tessera collects reporting from a lot of outlets, groups related articles into Stories as those
stories develop, and produces analysis where every claim points back at the reporting it came from.

The thing that makes that work is the ordering. Before any model gets called, Tessera pins down the
exact article snapshots it is allowed to use: an **EvidenceSet**, immutable, with stable ids (`A1`,
`A2`, and so on) and a SHA-256 over the lot. The model may cite those and nothing else. The
citations are then checked in backend code that sits underneath the prompt, so no amount of prompt
tuning can reach it. A claim citing something that isn't in the set gets dropped before anyone sees
it.

That is the whole idea. You should be able to check the analysis rather than trust it.

Built as a course capstone (Node/Express/TypeORM/PostgreSQL/React, JWT + RBAC), though the
architecture is meant to outlive the course. It runs locally. Nothing is deployed.

## What's in it

**Ingestion** reads four sources through one connector seam: curated RSS feeds, GDELT's GKG
firehose (a new window every 15 minutes), GDELT's DOC API, and Readability extraction off publisher
pages. Identity is the canonical URL, so when two connectors sight the same page the second one
*enriches* the row rather than making a duplicate. Every Publisher carries a Terms Class, and that
is what decides whether its text can be served at all.

**Clustering** embeds each article, compares it against Story centroids, and assigns it to the
nearest Story over a similarity threshold, with time as a hard gate. Two Publishers have to
corroborate each other before a Story exists at all: a Story of one is not a Story. Assignments
that fall just under the threshold go to a review queue instead of being guessed at.

**Generation** picks its evidence deterministically, freezes it, then writes cited claims under one
**Lens**. There are two, `student_context` and `investor_implication`, and the reader's role picks
which one rather than the reader choosing from a menu. That is what makes the Student and Investor
products actually different output instead of the same output with a flag on it. Investor analysis
has to state stakeholders, mechanisms and uncertainty, and validation throws out anything that
reads as a buy/sell recommendation or a price target.

**The knowledge graph** resolves entities out of the firehose annotations and links names that got
reported together. Every edge carries the article it was seen in, so any line in the picture opens
onto the reporting underneath it.

**Timelines** put a Story's reporting on the same axis as the analytical events that happened to it
(evidence freezes, finished generation runs). A search can be read the same way, one lane per
Story.

The three roles get different endpoints and different data, not different permissions over one
screen. Students get guided reading, cited flashcards on a spaced-repetition schedule, and their
own IntelligenceBriefs. Investors get consensus and contradiction across sources, publisher-leaning
spectrums with a blindspot signal, market indicators computed in-house against resolved tickers,
and uncertainty stated rather than smoothed over. Admin is an operator role, not a Brief owner:
connectors, the review queues, generation failures, user management, and versioned prompt tuning.

## Getting it running

You need Node 22+, npm 10+, and Docker with Compose. Your user has to be able to run `docker`
without `sudo` or the test suite won't work either (`sudo usermod -aG docker $USER`, then start a
new shell).

Postgres and Redis run in Compose. The API and the frontend run natively, which is deliberate
(ADR-0015).

```bash
docker compose up -d                       # Postgres on 5433, Redis on 6380

cd backend
npm install
cp .env.example .env                       # then put a real value in JWT_SECRET
npm run migrate
npm run seed
npm run dev                                # http://localhost:4000

cd ../frontend
npm install
npm run dev                                # http://localhost:5173
```

The ports are offset from the usual 5432/6379 on purpose, so they don't fight with anything already
running on your machine. `npm run migrate` is what creates the `vector` extension, so it has to
happen before anything touches an embedding. And there is no fallback `JWT_SECRET` on purpose —
`openssl rand -hex 32` will do.

Sign in at `/login`. Seeding makes one user per role, all on the same password (`tessera-demo`,
unless you set `SEED_PASSWORD`): `student@tessera.local`, `investor@tessera.local`,
`admin@tessera.local`.

**Seeding is the only way an Admin ever exists.** `POST /auth/register` will only make you a
Student or an Investor, because Admin is assigned rather than self-served. Skip `npm run seed` and
`/dashboard/admin` is a page nobody on the system can open. The seed is idempotent, so re-run it
after any migration; it also plants five graph-fixture reports and runs entity resolution, so
`/graph` has cited nodes and edges on a clean deploy without waiting for live ingestion.

### The worker

Ingestion, clustering and entity resolution happen in a separate process. It needs its own
terminal:

```bash
cd backend && npm run worker
```

It drains three queues on a schedule: ingestion on the quarter hour, clustering at :05, graph
resolution at :20. The Admin console's Run buttons put work on those same queues rather than doing
anything themselves, so there is only ever one execution path, and what you demo is what actually
runs. Run history is read out of Postgres and not the queue, which means the Admin console still
renders fine with the worker stopped — pressing a button then just queues the work for whenever it
comes back up.

Worth knowing before you sit and watch it: everything ingestion produces lands as an **Unclustered
Article**, which is invisible to browse and search, and it stays that way until clustering picks it
up. Only articles carrying text are eligible, and a Story still needs two Publishers, so plenty of
firehose rows never leave that state by design. A first hour of ingestion can easily cluster
nothing at all, and that isn't a bug. A tick works the fleet one connector at a time and the GKG
firehose alone is ~700 rows per window, so expect about a minute of work per tick.

### Providers, and running without any keys

It's meant to work with none. With no embedding key you get a network-free mock provider; with no
synthesis key you get a deterministic mock writing the analysis, and new Stories come out named
`[mock] <headline>`, which is the demo being honest that no model named them. If a hosted provider
is configured but unreachable, search drops back to lexical-only results instead of erroring.

Hosted providers need their model id set explicitly (`EMBEDDING_MODEL`, `SYNTHESIS_MODEL`), so model
ids stay deployment configuration rather than becoming defaults in the code. `.env.example`
documents the rest, including the thresholds. Evidence text does leave the process for the hosted
embedding and synthesis providers — both are free tiers chosen on access and cost, and ADR-0033 is
explicit that this is not a no-training contract.

If you point synthesis at a reasoning model, give it room: it spends most of a completion budget
thinking before it answers, so `SYNTHESIS_MAX_TOKENS` (default 4000) and `SYNTHESIS_TIMEOUT_MS`
(default 180000) exist to be raised rather than discovered.

One trap: **switching embedding providers means re-embedding everything.** The two vector spaces
have nothing to do with each other, and mixing them returns nonsense quietly rather than failing.
Re-running the seed won't fix it either, since seeding is idempotent and skips what already exists.
You have to drop the volume:

```bash
docker compose down -v && docker compose up -d
cd backend && npm run migrate && npm run seed
```

## Where things are

`/stories` is the corpus and `/stories/:id` is one Story with its cited analysis, coverage spectrum
and timeline. `/search` is hybrid search, Postgres full-text and pgvector cosine fused by
reciprocal rank, and `/timeline` reads a search as one lane per Story. `/graph` draws the
co-occurrence graph, bounded so it stays legible, and `/graph/entities/:id` is one name's
neighbourhood with the reporting sitting under every link. `/briefs` is where the owned artifacts
live, `/study` is the flashcards, `/dashboard/:role` covers the three dashboards, and `/status` is
a live health check if you want to confirm the API is actually up.

```
backend/
  src/ingestion/     runConnector          RSS, GKG firehose, DOC, Readability
  src/clustering/    runClustering         embed, centroid, nearest Story
  src/generation/    runGeneration         freeze evidence, then cited claims
  src/graph/         runEntityResolution, loadGraphView
  src/timeline/      buildTimeline         takes a set of Articles, never a query
  src/market/        quotes and in-house indicators behind one provider seam
  src/worker.ts      separate process, three BullMQ queues
frontend/            Vite + React, Base UI, Recharts, Cytoscape.js for the graph
docs/adr/            37 decision records; an ADR beats the spec where they disagree
docs/architecture/   four generated diagrams: data model, request lifecycle,
                     async pipeline, caching layers
```

A few of those choices are deliberately not the obvious ones. The knowledge graph is plain Postgres
tables and recursive CTEs rather than a graph database. The queue is Redis and BullMQ rather than
cron. Model ids always come from environment config. The reasoning for each is in `docs/adr/`.

## Tests

```bash
cd backend  && npm test
cd frontend && npm test && npm run build
```

Backend tests drive the real Express app with `supertest` against a real Postgres, spun up per run
by Testcontainers, so there's no test database to set up by hand. You do need Docker working. Redis
is deliberately left out of the test stack and the single enqueue call is stubbed instead. The
frontend suite is Vitest, jsdom and React Testing Library over the components that carry real state
logic, asserting the four UI states with a stubbed `fetch` — no database, no running backend.

There is no lint script in either package yet, so don't claim lint passes.

Checks that hit real third-party endpoints are opt-in behind env flags (`GDELT_LIVE_SMOKE`,
`SYNTHESIS_LIVE_SMOKE`, `EXTRACTION_LIVE_SMOKE`). The extraction one takes about a minute because
it paces itself to one request per publisher every two seconds.

## The other documents

- `CONTEXT.md` — the glossary. Story, Article, EvidenceSet, Lens and the rest mean exactly what
  this file says they mean, in code and in conversation
- `DESIGN.md` — the design system: one token contract, a palette per role, and the four states
  every route has to answer for
- `docs/adr/` — 37 architecture decisions. Where an ADR and anything else disagree, the ADR wins
- `docs/architecture/` — four standalone diagrams, openable straight from the browser

## Status

Phases 1 through 3.6 are complete: ingestion, clustering, cited generation, the knowledge graph,
both timelines, and the product rebuild that gave the three roles their own theme, the Investor
market panel, and the Admin console its user and connector management.

Typed relations on graph edges are deferred (ADR-0019). Monitoring and alerting are out of scope for
the graded build rather than missing. The evaluation harness is the one module still to come.
