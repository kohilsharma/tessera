# Phase 3.6 — Product overhaul

The design system themed by role, the feature builds, the system-design additions, and the
walkthrough bugs. Spec: `docs/phase-3.6-spec.md`. Epic: #71.

Phase 3.6 opens by **closing the phase beneath it** (#72). ADR-0022 gave Phase 3.5 an exit criterion
— a clean 50–200-node graph and a timeline rendering for seeded Stories — and nothing had ever
checked it, so `/graph`, one entity neighbourhood, a Story timeline and `/search/timeline` were four
surfaces *believed* to work. All four render, and the evidence is nine screenshots in
`docs/verification/phase-3.5/` at the bureau-rollout's two widths (1050 and 560).

`/graph` draws **60 nodes and 293 edges** over a corpus of 3,589 promoted names. 60 is
`GRAPH_VIEW_NODES` exactly, so the band is met by the bound rather than by luck — the view is doing
the work the seam promises, and says so on screen ("60 of 3589 names"). The neighbourhood was
asserted rather than eyeballed: for Donald Trump the payload is the focus plus **59 one-hop
neighbours, every one incident to the focus, zero non-neighbours, 324 edges** — depth 1 including
neighbour-to-neighbour edges, which is the picture `NEIGHBOURHOOD_DEPTH` is meant to produce. Its
edge-citation drawer reads "The 20 most recent of 207 reports that named Donald Trump and Iran
together", and labels one citation "Not in a Story · reads at dailymirror.lk" — ADR-0028's
documented exception working exactly as written: membership ran, and it *labelled* the citation
instead of filtering it. The Story timeline resolves at day granularity with three reporting points
and both analytical events ("Evidence frozen · 3 articles", "Analysis completed · Student context"),
so `buildTimeline` is drawing reporting and generation on one axis. `/search/timeline?q=iran`
returns a master axis and three Story lanes bucketed against that *shared* axis, which is the
property that makes simultaneous coverage read as parallel rather than as three unrelated charts.

The worker was watched through all three tick types live: ingestion (13 connectors enqueued; the GKG
firehose 759 discovered / 723 inserted, DOC 217 / 184), clustering (55 embedded, 339 considered, 2
assigned, 4 held for review, 333 left unclustered — the firehose staying invisible by construction),
and entity resolution (355,332 retained annotations across 18,807 Articles, 55,285 names considered,
4,107 promoted, 51,178 below the floor, 1 pair merged, 336 proposed for review, 63,526 edges built).
The corpus grew from 3,589 to 4,106 names during the pass, which is the rolling window doing what it
claims.

**"Clean deploy" was read non-destructively, and that is a deviation worth naming.** `docker compose
down -v` would have destroyed 1,065,196 GKG annotations, 17,673 Articles and 3,589 Entities — and
because ADR-0028 makes the graph firehose-derived, a wiped volume cannot satisfy the graph half of
the exit criterion at all; the two halves of the ticket would have fought each other. The documented
path was proved from nothing instead, in a scratch database (`tessera_cleancheck`) inside the
running container: **26 migrations executed, `npm run seed` exit 0**. So `SETUP.md` is confirmed to
work from empty, and the surfaces are confirmed against the only corpus that can exercise them — two
halves that never met in one run, which is the honest limit of the check.

Three complaints were investigated and dismissed as correct behaviour. The 2008–2026 reporting span
printed beside "Rolling 7 days" is two deliberately different facts, which `loadGraphView.ts:34–46`
already documents: retention governs which annotations are read, not what dates the Articles behind
them carry. Two "United States" nodes are a cross-kind pair the merge step refuses by design, and
the view prints KIND beside each name so the refusal is legible. "Request analysis" reappearing
after a completed analysis, and the timeline's inert volume bars, are both already scoped in the 3.6
spec (§6) and belong to their own tickets.

Three findings came out of the pass, plus one the closing test run turned up. Per #72's fourth
bullet none was fixed here; each is filed as its own issue, and each is written out below too,
because the phase file is where the next session looks first.

The one confirmed defect is a **layout collapse in the edge-citation drawer** (#103): every headline
inside it renders one character per line, `a.entry-title` measuring `0px × 1829px`. The cause is not
the drawer. `.entry` is `grid-template-columns: minmax(0, 1fr) auto` (`styles.css:223`), a row body
renders inside that first track, and the drawer puts an `EntryList` — more `.entry` rows — into a
281px container, where the `auto` register track takes its 243px max-content and the name track,
floored at zero, gets nothing. So the bug is `.entry`'s missing minimum, and the next register
nested in a row body would hit it too; the fix belongs there rather than on `.graph-evidence`. It is
a desktop-only bug, since `@media (max-width: 560px)` collapses `.entry` to one column — which is
why there is no 560 capture of it. The other `body=` caller, the merge-review queue
(`adminRegisters.tsx:384`), draws `ul.claim-sides` instead and measures clean at 564px.

The second is a **demo-readiness gap** (#104): a clean `npm run seed` produces an empty graph.
`runEntityResolution()` succeeds and `loadGraphView()` then returns `entityCount: 0`, because the
seed's 137 GKG annotations cannot clear a promotion floor of 5 distinct Articles. The empty state is
honest and well written, but ADR-0022's "renders for seeded Stories, degrades to fixtures if time is
short" is satisfied by neither branch for the graph: there are no fixtures, and the seed does not
reach the floor.

The third is **node quality** (#105). Of the 60 drawn names, 48 are typed `location`, 9
`organization`, 3 `person`; about eleven are demonyms sitting under `location` ("American",
"British", "Iranian", "Canadians"…), and "Los Angeles" is typed `person`. The promotion floor's
rationale is that a mistake is rarely made five times — which holds for typos and does not hold for
a demonym, because GKG makes that call consistently.

The fourth is a **50/50 flake in the backend suite** (#106), standing at HEAD and unrelated to this
ticket's docs: `clustering.test.ts` → "seeds and names nothing … when the synthesis config cannot
build a provider" fails on about half of runs (measured: fail, pass, fail on three consecutive runs
of the single test). `medoidOf` scores each member by its summed similarity to the others, so on a
**two-member** group both members score identically and the tie falls to `member.id < best.id` — a
comparison of two random UUIDs. The test then asserts one specific headline. The code is not wrong,
because with two members neither article is more central than the other; the assertion
over-specifies what the tie can answer. Worth knowing that the Story *slug* rides on the same coin
flip, harmlessly, since it only has to be unique.

**Bureau is retired** (#73). `DESIGN.md` had already been rewritten (cbbec4a), so this ticket was the
other half of the reversal: delete the world it replaced, and record why in **ADR-0031**.

The deletion is `frontend/src/versions/BureauPrototype.tsx`, `versions/bureau.tsx`, the hardcoded
fixtures in `src/data.ts`, the `/design-prototype` route, and the `.design-bureau` block — HEAD lines
691–896, **206 lines, 27.6% of the stylesheet by bytes** (21.3% by lines), styling a page no route in
the app linked to. The spec's estimate of "~35%" measured from the block's banner to end of file,
which also swept up the STUDY and KNOWLEDGE GRAPH sections that sit *after* it and are live app CSS;
that range is 34.9%, and 27.6% is the block itself. `styles.css` goes 967 → 761 lines and
77,698 → 56,468 bytes, and the shipped CSS bundle is 26.50 kB gzipped to 5.40 kB. **No test
changed**: nothing in the suite ever rendered the prototype, so 183 tests across 15 files and
`npm run build` were green on the deletion alone.

Two things the cut swept up were **not** Bureau's and stayed. The
`@media (prefers-reduced-motion: reduce)` block sat immediately after the block closed rather than
inside it, and is app-wide — it is what collapses every transition in the app, and #78's sign-in
sweep when that lands — so rather than leave a global rule stranded where a deleted section used to
be, it moved up to the globals beside `:focus-visible`. It has to stay *after*
`html { scroll-behavior: smooth }`: the reduce block's `html { scroll-behavior: auto }` carries the
same specificity and no `!important`, so source order is the only thing deciding which wins. Nothing
re-declares `scroll-behavior` after the new position, so the move is inert today and the constraint
is written down here for whoever adds the next global. And `@keyframes registration-arrives`, the
pending state's 320ms reveal, lives in the app section — after the cut it is the **one** keyframe
left in the stylesheet, which was the whole indictment of the old system in the first place.

The `:root` palette — `--bureau-ink`, `--proof-blue` and their siblings — was deliberately left
alone. Those names are Bureau's but the tokens are not in the deleted block: every live page reads
them, and `components/graphRegister.tsx` reads six of them at draw time — the ink, the paper, the
quiet rule, and the three kind colours through `KIND_MARK` — so the graph's key and its picture
cannot disagree. #74 replaces them wholesale with the token contract; replacing them here
would have meant reskinning the whole app inside a deletion ticket. The stylesheet's other comments
citing withdrawn `DESIGN.md` rules ("reserves motion for registration", "the Redundant Signal Rule",
the offset registration shadow) were left for the same reason — #74–#77 replace that sheet with CSS
Modules over the new contract, so rewriting prose scheduled for deletion is work that dies in three
tickets. Only the one comment that pointed *at the deleted route* was rewritten.

Stale pointers swept: `AGENTS.md` (which told every session the prototype was safe to change),
`SETUP.md`, `docs/repo-state/frontend.md` — now past-tense with the ticket number — and one line in
`docs/verification/bureau-rollout/README.md` that still sent a reader to `/design-prototype`. The
directory itself is kept as the ticket asked, and only annotated: the rollout happened, it was
verified at two widths, and deleting the proof would only make the history unreadable.

One discrepancy for #74 to know about: **spec §1.2 lists fifteen tokens and then adds `--focus`,
while the committed `DESIGN.md` §2 says twenty-two.** `DESIGN.md` is the later document and the
authoritative one — the six it adds on top of the spec's sixteen are the three `-text` variants for
small text on light accents, `--on-accent`, and `--up` / `--down` for market direction (deliberately
not `--agree` / `--diverge`, because a price falling is not a claim being contradicted).
