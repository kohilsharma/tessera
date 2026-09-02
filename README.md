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
own IntelligenceBriefs. Investors get consensus and contradiction across sources, sector filtering,
and uncertainty stated rather than smoothed over. Admin is an operator role, not a Brief owner:
connectors, the two review queues, generation failures, and versioned prompt tuning.

## Getting it running

You need Node 22+, npm 10+, and Docker with Compose. Your user has to be able to run `docker`
without `sudo` or the test suite won't work either (`sudo usermod -aG docker $USER`, then start a
new shell).

Postgres and Redis run in Compose. The API and the frontend run natively, which is deliberate
(ADR-0015).

```bash
docker compose up -d
```

That gives you Postgres on **5433** and Redis on **6380**. Both are offset from the usual ports on
purpose, so they don't fight with anything already running on your machine.

Backend next:

```bash
cd backend
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run dev            # http://localhost:4000
```

Two things about that block. `npm run migrate` is what creates the `vector` extension, so it has to
happen before anything touches an embedding. And you have to put a real value in `JWT_SECRET`
before `npm run dev` will sign anything. There is no fallback secret on purpose; `openssl rand -hex
32` will do.

Then the frontend, in another terminal:

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

Sign in at `/login`. Seeding makes one user per role, all on the same password (`tessera-demo`,
unless you set `SEED_PASSWORD`):

| Email | Role |
|---|---|
| `student@tessera.local` | Student |
| `investor@tessera.local` | Investor |
| `admin@tessera.local` | Admin |

**Seeding is the only way an Admin ever exists.** `POST /auth/register` will only make you a
Student or an Investor, because Admin is assigned rather than self-served. Skip `npm run seed` and
`/dashboard/admin` is a page nobody on the system can open.

`SETUP.md` has the rest: every environment variable, the embedding and synthesis providers, and the
things that go wrong.

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
renders fine with the worker stopped. Pressing a button then just queues the work for whenever it
comes back up.

Worth knowing before you sit and watch it: everything ingestion produces lands as an **Unclustered
Article**, which is invisible to browse and search, and it stays that way until clustering picks it
up. Plenty of firehose rows never leave that state, by design. A first hour of ingestion can easily
cluster nothing at all, and that isn't a bug.

### If you have no API keys

It's meant to work without any. With no embedding key you get a network-free mock provider. With no
synthesis key you get a deterministic mock writing the analysis, and new Stories come out named
`[mock] <headline>`, which is the demo being honest that no model named them. If a hosted provider
is configured but unreachable, search drops back to lexical-only results instead of erroring.

One trap: **switching embedding providers means re-embedding everything.** The two vector spaces
have nothing to do with each other, and mixing them returns nonsense quietly rather than failing.
Re-running the seed won't fix it either, since seeding is idempotent and skips what already exists.
You have to drop the volume:

```bash
docker compose down -v && docker compose up -d
cd backend && npm run migrate && npm run seed
```

## Where things are

`/stories` is the corpus and `/stories/:id` is one Story with its cited analysis and coverage
timeline. `/search` is hybrid search, Postgres full-text and pgvector cosine fused by reciprocal
rank, and `/search/timeline` is the same results read as one lane per Story. `/graph` draws the
co-occurrence graph, bounded so it stays legible, and `/graph/entities/:id` is one name's
neighbourhood with the reporting sitting under every link. `/briefs` is where the owned artifacts
live, `/study` is the flashcards, `/dashboard/:role` covers the three dashboards, and `/status` is
a live health check if you want to confirm the API is actually up.

Layout:

```
backend/
  src/ingestion/     runConnector          RSS, GKG firehose, DOC, Readability
  src/clustering/    runClustering         embed, centroid, nearest Story
  src/generation/    runGeneration         freeze evidence, then cited claims
  src/graph/         runEntityResolution, loadGraphView
  src/timeline/      buildTimeline         takes a set of Articles, never a query
  src/worker.ts      separate process, three BullMQ queues
frontend/            Vite + React, Cytoscape.js for the graph
docs/adr/            29 decision records; an ADR beats the spec where they disagree
```

A few of those choices are deliberately not the obvious ones. The knowledge graph is plain Postgres
tables and recursive CTEs rather than a graph database. The queue is Redis and BullMQ rather than
cron. Model ids always come from environment config, never a default in the code. The reasoning for
each is in `docs/adr/`.

## Tests

```bash
cd backend  && npm test
cd frontend && npm test
cd frontend && npm run build
```

Backend tests drive the real Express app with `supertest` against a real Postgres, spun up per run
by Testcontainers, so there's no test database to set up by hand. You do need Docker working.
Redis is deliberately left out of the test stack and the single enqueue call is stubbed instead.

There is no lint script in either package yet, so don't claim lint passes.

Checks that hit real third-party endpoints are opt-in behind env flags (`GDELT_LIVE_SMOKE`,
`SYNTHESIS_LIVE_SMOKE`, `EXTRACTION_LIVE_SMOKE`). The extraction one takes about a minute because
it paces itself to one request per publisher every two seconds.

## The other documents

- `SETUP.md` — the full setup path, every env var, providers, what goes wrong
- `CONTEXT.md` — the glossary. Story, Article, EvidenceSet, Lens and the rest mean exactly what
  this file says they mean, in code and in conversation
- `PRODUCT.md` — audiences, positioning, and the things Tessera deliberately doesn't do
- `DESIGN.md` — the Bureau design system the UI is built in
- `AGENTS.md` — the working agreement: module seams, invariants, how to verify a change
- `docs/adr/` — 29 architecture decisions. Where an ADR and the spec disagree, the ADR wins
- `docs/repo-state.md` — per-ticket history and the measurements behind the decisions
- `project-docs/` — the build specification, the course statement, and the initial report

## Status

Phases 1 and 2 are done, Phase 3 through #58, and Phase 3.5 is in progress. Entity resolution, both
timelines, candidate merges, the bounded graph, one Entity's neighbourhood and the repaired
extraction pass are all in.

Typed relations on graph edges are deferred (ADR-0019), and monitoring and alerting are out of
scope for the graded build rather than missing.
