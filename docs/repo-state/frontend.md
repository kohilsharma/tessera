# Frontend

The route table, the shell, and the Bureau rollout. Largely superseded by Phase 3.6 — read `DESIGN.md` for what replaces it.

**frontend/** — `src/App.tsx` is the route table alone; chrome comes from `components/AppShell.tsx`.
Live, `fetch`-based pages (`src/api/client.ts`) cover health (`/status`), auth (`/login`,
`/register`, `/account`), role dashboards (`/dashboard/:role`), browsing the corpus
(`/stories`, `/stories/:id`, `/articles/:id`), IntelligenceBriefs (`/briefs`, `/briefs/:id`),
search (`/search`, `/search/timeline`), the knowledge graph (`/graph`,
`/graph/entities/:entityId`), and the Student study
session (`/study`). The
**Bureau rollout** (#28) is mid-flight: root design tokens and the
application shell (#29), the four shared UI-state treatments and restyled list controls (#30),
and the Index archetype across all three of its consumers — `/stories` (#31), `/briefs` and
`/search` (#32) — are done, as is the Record archetype across all three of its consumers:
Story and Article detail (#33) and Brief detail as the owned artefact (#34), and the Form
archetype across registration, sign-in, and the Brief form — which gained its own
cover-image control (#35), and the Dashboard archetype across all three roles (#36).
The cross-route responsive and accessibility sweep (#37) closed it out: `/account` and
`/status` became stated pages in the same vocabulary, and every route's screenshots at both
breakpoints sit in `docs/verification/bureau-rollout/`. `/` redirects to the caller's own
dashboard. Story detail's coverage register *is* the **timeline** (#64):
`components/timelineRegister.tsx` — shared, because #65 draws the same thing over a search — is
the volume overlay over the reporting and the analytical events interleaved in time order, each
Article row still the Index archetype's own entry opening its Article, each event row naming
itself over its ledger. It folds in the Articles register #33 shipped rather than listing the
same rows twice, and owns its own request and so its own four states: a Story with no datable
reporting says that, and a failed request says *that* while still listing the Articles off the
record this page already loaded. `pages/SearchTimeline.tsx` at `/search/timeline` is the Index
archetype's fourth surface and that register's other consumer (#65): the same filter register and
the same Article rows, but what it registers is a `<section>` per Story rather than a ranked list,
each headed by a link into the Story, each drawing its bars through the shared `TimelineVolume`
against one page-wide `peak` so a tall bar means the same count in every lane. `/search` and it
are one address bar — `useListQueryParams` hands over `queryString` whole, so `Read as a timeline`
and `Read as a ranked list` switch the reading without re-typing the query, and `q` survives Clear
filters on both. `pages/Graph.tsx` at `/graph` is the **knowledge graph** (#68) and the app's third
way into the corpus, nav-level beside Stories and Search rather than under either, because what it
reads is a different corpus — stated in the reader's own language in prose *and* in the ledger
register every other surface states its facts in (Corpus, Window, Reporting, Drawn), beside the
picture rather than under it. Kind is carried three ways at once, per DESIGN.md's Redundant Signal
Rule: ink, canvas shape — a square node for an organization, since corners are square here — and
the word itself, in a legend naming only the kinds actually drawn and again in every register row,
so the graph reads in greyscale and to anyone who cannot tell `--proof-blue` from
`--registered-overlap`. The Cytoscape canvas reads those inks from the Bureau tokens at draw time,
so the picture cannot drift from the legend beside it, which takes the same tokens through CSS.
Nothing on the page is stated by the drawing alone: `toGraphElements` is exported and pure — jsdom
renders no canvas, so the renderer is stubbed and that mapping is what the tests of the register it
now lives in (`components/graphRegister.tsx`, shared with #69) hold to account — and under the plot,
**Names in the graph** is the same graph in words through the
Dashboard archetype's register, every drawn name in the view's own order with the two quantities the
picture encodes as node size and line width written out. That register is the reading a keyboard and
a screen reader get, which is why the canvas is a `role="img"` that says what it draws and points at
it, and why nothing on it is grabbable or selectable: a tap on a node is one gesture with one
meaning, opening that name's own neighbourhood (#69), and dragging or selecting would compete with
it. `Drawn` states `3 of 5 names` or `All 3 names`, so a reader is never left thinking the
bound is the graph. Story detail carries the **analysis surface** (#53): a Request-analysis command (a
mutation, never a fetch on render, since an analysis may cost money), a Lens select for an Admin
only — a reader's Lens is their role, and the API refuses one from them — claims grouped by kind
in the record's note register with each citation an `A1 · Publisher` link to the Article it
resolves to, and a stated unavailable panel — worded per `failureCode` — for a run that failed
rather than any part of it. A completed analysis carries a **Save to a new Brief** command (#55)
for the two roles that own Briefs — never for an Admin, whom the API refuses — landing the reader
on the Brief they now own; Brief detail carries the saved analysis as its own register, rendered
by the register both records share (`components/analysisRegister.tsx`), stated as frozen. That
shared register reads differently under the two Lenses (#56), off the analysis's own `lens` so a
saved investor analysis keeps its reading in a Brief: agreement, then disagreement, then the
implication, with single-source reporting last; each consensus claim states the Publishers it was
cited to out of the set's own count; a contradiction is rendered as its **sides** — one factual
proposition with supporting and contradicting citations persisted below the prompt, each carrying
its Publisher, headline and link to open it — instead of a flat citation row; and the disagreement
register is kept even when it is empty and says so, since a contradiction can be refused for
missing a side (#54) and silence would read as agreement. For a Student the shared register also
carries **Make flashcards** (#58), whether the analysis is fresh on a Story or frozen in a Brief;
it lands on `/study`, which presents one due card at a time, hides the cited answer until recall,
then records Again/Hard/Good/Easy as SM-2 grades. The surface uses all four shared UI states and
states the difference between no cards and nothing due. The Investor dashboard gained a second
register routing into it (**Comparable coverage**), listing only Stories whose evidence still
holds two Publishers after the same near-duplicate collapse generation runs. The Admin console gained a fourth register for **IngestionRun** history and Run /
Enable-Disable commands on each connector row (#39 — Run states that it queued the run, since
the worker is what executes it, #42), and each publisher row shows its Terms
Class beside its article count (#40). A fifth register carries **ClusteringRun** history with a
Run-clustering command on the register itself (#49 — one pass over the whole corpus, so there is
no row to hang it on), a sixth carries **EntityResolutionRun** history with a Run-resolution
command for the same reason (#66, #67 — Annotations, Articles, Considered, Promoted, Below floor,
Demoted, Merged, Proposed and Edges per row; it too states that it *queued* the pass, since the
worker is what promotes and connects), and a seventh is the **clustering review queue** (#50) —
with its own request, so it owns all four UI states, with Accept/Reject on each proposal row. An
eighth is the **entity merge review queue** (#67), the same shape one scale down: its own request
and four states, Accept/Refuse per row, and each row holding both surface names with the reporting
behind each in the analysis register's ruled pair. A ninth is **Story merge** (#52), the console's
one command *form*: two selects over the 50 most
recent Stories (its own request, refetched after a merge since one of the pair is gone), a Merge
command refused client-side for a Story named twice, and a stated note reporting what the merge
did rather than what it queued. A tenth is **Prompt versions** (#57), a register and a second
command form: each version states its own parameters in the note line so two can be told apart
without opening either, a Make-current command on every row but the current one, and a form whose
fields are the whole tuning surface — there is no control for the citation check, because it is
not configuration. Those six Phase-3 registers live in `pages/adminRegisters.tsx`, each owning
its own request and commands; `pages/AdminDashboard.tsx` is the console that lays them out and
the two registers reading its own payload. The
**design prototype** for the Phase-3 flagship (`src/versions/BureauPrototype.tsx` +
`bureau.tsx` over hardcoded `src/data.ts`, styled by `src/styles.css`) sat at
`/design-prototype`, out of the Phase-1 path — until #73 deleted all four with the design system
they demonstrated (ADR-0031).

`npm run migrate` (backend) applies migrations; `npm test` (backend) is the API-seam test
pattern (supertest + an ephemeral Testcontainers Postgres) later Foundation tickets extend.
