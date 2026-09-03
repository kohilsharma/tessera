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

**#74 — the token contract and the six role palettes.** The contract lands as
`frontend/src/tokens.css`, 147 lines, imported before `styles.css` in `main.tsx`. Six palettes —
Newsroom, Terminal and Studio, each light and dark — every one declaring the same twenty-two colour
names, which is the whole mechanism: a component reaching for `var(--agree)` is correct under all
six, and the palettes cannot drift apart because a missing or extra name fails the build. The
discrepancy above was resolved in `DESIGN.md`'s favour, as the ticket directs. Values were copied
from §3 rather than re-derived, and the file says so.

The one structural decision: the non-colour tokens a theme owns — `--font-display` / `--font-ui` /
`--font-mono`, `--t-display`, `--w-display`, `--radius`, `--radius-lg`, `--shadow` — are declared on
the *light* selector only. `[data-theme="studio"]` and `[data-theme="studio"].dark` match the same
`<html>` element, so dark inherits them; type and shape are theme-level facts, not mode-level ones,
and writing them three times instead of six removes the only place the two modes of a theme could
disagree about a typeface. The single exception is Studio's dark `--shadow`, which is genuinely
mode-dependent: the light one is tinted from Studio's own ink at .05/.10/.12 alpha, and a shadow
tinted from a light ink is invisible on a dark ground, so dark re-declares it in black at
.5/.55/.6.

Contrast is re-verified, which was the ticket's actual demand. `src/tokens.test.ts` parses
`tokens.css` itself — not a transcribed table — and recomputes WCAG relative luminance for every
pairing against that palette's own `--paper`. Text tokens land 4.54–17.35:1 and marks 3.03–9.88:1
across all six, so every palette clears 4.5 for text and 3.0 for marks as `DESIGN.md` §2 states.
The two corrected focus rings sit at exactly **3.03:1** in Newsroom and Studio light: that is #73's
correction made measurable, and the margin is three hundredths, so any later darkening of a light
paper or lightening of `--focus` fails the suite rather than shipping. Tightest text is Terminal
light's `--diverge-text` and Studio light's `--agree-text`, both 4.54.

One honesty note about that ring, because two comments used to overstate it. Every ratio above is
measured against `--paper`, which is §3's stated basis and the only correct basis for a palette —
but no page paints `--paper` yet. On the ground actually painted today, Bureau's `#f2f0e9`,
`#c08400` measures **2.82**, so the ring is an improvement on Bureau's amber (1.79 on that same
ground) and still short of 3:1 until #76 migrates the ground. The correction and its pass arrive in
different tickets; `styles.css` says so where `--focus` is wired.

Measuring the whole matrix turned up three thin pairings `DESIGN.md` does not record, and #76 has
to respect all three. **`--on-accent` on a filled accent bottoms out at 3.35:1** — Studio light's
`--agree`, with `--diverge` at 3.84 — which passes 1.4.11 as a mark and AA Large at ≥18.66px, and
fails AA for body text: a filled Studio pill needs large or bold text, or the `-text` value on its
wash instead. **Each `--*-text` on its own `--wash-*` lands 4.23–4.49 in Studio light** and 4.37 for
Terminal light's `--diverge-text`, marginally under 4.5 — and that is precisely the pairing §8's
claim rendering asks for, a tinted card with a coloured stance label, so #76 either darkens those
three values or sets the label large. **`--rule2` against `--paper` is 1.49–1.81** in all six:
correct for a hairline between two content blocks, wrong for a control boundary, so an input border
or an unchecked checkbox drawn in it fails 1.4.11 and wants `--quiet` (4.54 or better everywhere).
The tests pin these three at 3:1 rather than 4.5 with the reason in a comment, so the suite records
where the ceiling is instead of pretending there isn't one.

Beyond ratios the 38 assertions pin the shape of the contract: the exact six selectors; exactly the
twenty-two names per palette; the three dark grounds distinct (`#141310`, `#0b0e11`, `#16151d`); the
eight theme-level tokens present on each light block; `--shadow` non-`none` in Studio alone, which is
§5's depth rule as a test; and `:root` carrying the six `--t-*` and nine `--s-*` in order. The last
assertion re-parses `DESIGN.md` §3 and compares hex for hex, so specification and implementation
cannot fall out of step in either direction. Proved the check bites by mutation — lightening
`--quiet` from `#6d685e` to `#9d988e` failed two assertions at 2.71:1 before it was restored. The
suite reads both files with `readFileSync(new URL(…))`, which is why `@types/node` is now a frontend
devDependency: `import "…/DESIGN.md?raw"` needs `server.fs.allow` widened to the repo root, and vite
hands the allow check the id *with* its `?raw` query, so an exact-file entry never matches. A types
package that touches nothing at runtime was cheaper than widening dev-server filesystem access.

Type is wired per theme, so all three faces render rather than merely existing. The UI and mono
stacks swapped app-wide: 29 sites in `styles.css` — four `Arial, Helvetica, sans-serif` to
`var(--font-ui)`, twenty-five mono stacks to `var(--font-mono)` — plus
`:root { font-family: var(--font-ui) }`, and a thirtieth outside the stylesheet, since
`graphRegister.tsx` sets Cytoscape's node-label font in JS and was still passing Arial into the
canvas in all three themes; it now reads `token("--font-ui")` through the helper it already uses for
colour, so the graph's labels and its key cannot disagree about a typeface. The display face is
wired at the two rules that own a page title — `.index/.form-page/.dashboard/.stated-page h1` and
`.record-mast h1` — taking `var(--font-display)` and `var(--w-display)`, which is what makes 400 for
a serif carrying no bold, 700 for Terminal and 800 for Studio a theme fact rather than a hard-coded
one. Without it the three display families were being fetched and never drawn.

`--focus-amber: #f0a800` is deleted and both its consumers read `var(--focus)`, so the ticket's
second correction is live rather than documented. Font *sizes* did not move: the `--t-*` scale
exists, `--t-display` included, and the two title rules keep Bureau's fluid `clamp()` — `DESIGN.md`
§4 gives `--t-display` one value and no responsive story, and a flat 3.6rem at 390px overflows, so
the clamp that replaces it is #76's per-surface judgment. Nor did colour: the thirteen surviving
Bureau names, and `:root`'s own `color` and `background`, stay on Bureau's values, since swapping
ground and ink piecemeal would put two different warm-whites side by side on one page. #76 replaces
all of them in a single pass.

Last, the surfaces nobody draws. A closing block themes what ships with a browser default:
`color-scheme` per mode — without it the three dark palettes render a white native scrollbar down
the side — plus `caret-color`, `accent-color` and `scrollbar-color`. `::selection` takes `--rule2`
rather than a claim wash: `--wash-imply` would paint "implication" across a selected contradiction,
and §2 gives every token one meaning. `--ink` on `--rule2` measures 8.84–10.94 across the six, and
`--rule2` sits 1.49–1.81 off its own paper, so the band reads without competing with the tint under
it. `index.html` gains `data-theme="newsroom"` (the authored default and the signed-out theme, which
#75's role swap replaces at sign-in), **one** `theme-color` — Bureau's `#f2f0e9`, because the chrome
has to match the ground actually painted, and a `prefers-color-scheme: dark` meta would have put
near-black browser chrome above a page that only renders light until #75 makes `.dark` apply at all
— and one Google Fonts request for the eight families the three themes name. Eight, not nine:
Terminal spends one family on both display and UI and separates them by weight. Browsers fetch only
the woff2 of a family they actually render, so a reader in one theme does not pay for the other two.

Three things the next tickets need from here. **#75 must guarantee `data-theme` always resolves to
one of the three names**: about twenty-five label rules put `var(--font-mono)` inside the `font`
shorthand, and an unmatched theme leaves the property unresolved, which invalidates the *whole*
declaration at computed-value time — the labels would lose their size and weight, not just their
family. **#76 inherits a contract gap**: §3 records small-text substitutes (`#777167`, `#736f7e`,
`#3a66eb`) that no token names, so the spectrum axis has no `-text` variants the way the claim axis
does, and a surface needing small spectrum text has to hard-code against §2 rule 1. And the label
shape itself — `font: 500 .66rem var(--font-mono)` with uppercase and tracking, repeated at some
twenty-five sites — was left duplicated on purpose: one shared class would touch every rule *and*
every component that names them, inside a 762-line sheet #76 replaces with CSS Modules over this
contract. Collapsing it there costs one sweep instead of two.

Verified: 221 frontend tests across 16 files, `tsc --noEmit` clean, build green. A headless Chromium
probe resolved all six theme×mode combinations against the live dev server — every palette's paper,
ink and focus correct, `color-scheme` flipping, Studio's dark shadow overriding, and `/login`
rendering in Archivo + IBM Plex Mono under Newsroom and DM Sans + DM Mono under Studio with layout
intact at 1440 and 390. The token layer costs 3.26 kB of CSS, 1.27 kB gzipped (26.50 → 29.76 kB;
5.40 → 6.67 kB).

**#75 — theme by role, with a light/dark override.** Two axes, and the ticket's whole shape is that
only one of them belongs to the reader. `frontend/src/theme.ts` holds the mapping — Admin →
Newsroom, Investor → Terminal, Student → Studio — typed `Record<UserRole, ThemeName>`, so a fourth
role added to the backend fails to compile here rather than quietly theming itself as the signed-out
product. `themeForRole()` is nevertheless **total over `string | null | undefined`** with a Newsroom
fallback, which is #74's handoff demand discharged: its argument is whatever a JWT happened to
carry, not something already known to be a role, and an unset `data-theme` is not a plain page but a
broken one. The other axis is a `colorMode` column on `User` — `system | light | dark`, migration
`1755766000000`, a named CHECK constraint over the three values — applied as `.dark` on the same
`<html>` element the attribute sits on.

Nothing is duplicated per theme, which is the done-when that constrains everything else: the six
palettes already key off one attribute, so the entire client-side surface of this ticket is one
`applyTheme(role, mode)` that sets an attribute and toggles a class. Where it runs is the judgment.
It runs **synchronously in `main.tsx` before `createRoot`**, off the stored JWT's role claim and a
`tessera_color_mode` hint, because `index.html` ships `data-theme="newsroom"` and no `.dark`: applied
in an effect, a signed-in Investor would see one frame of the wrong product and a dark-mode reader
one frame of cream. Both inputs are local, so this costs no round trip. `components/ThemeSync.tsx`
then renders `null` beside `<App />` and is the reactive authority once mounted — it watches the
`["me"]` query, so the server's `colorMode` outranks the hint, and it owns the `matchMedia`
subscription that makes `system` actually track the OS mid-session. Its `enabled: !!getToken()` is
load-bearing rather than an optimisation: `authFetch` answers a 401 by navigating to `/login`, so an
unguarded `/auth/me` from a root-level component is a redirect loop on the login page itself.
`postForToken` and `logout` repaint directly, at the one seam where a session begins or ends, since
that answer already carries both halves and waiting for a refetch is what "visibly switches
products" cannot afford. The hint survives sign-out on purpose: it is a fact about this device, and
clearing it would make every signed-out surface flash against the reader's own preference.

Not user-overridable, per spec §12, is enforced at the API and not merely omitted from the UI:
`PATCH /auth/me` refuses a body naming `role` or `theme` with 422 rather than dropping it silently,
because a silent drop leaves a caller believing it took. Account states the Role Theme in its
register beside the role that decides it — a fact the reader can read, rather than a control they
cannot have — and offers only Appearance. It is named **Role Theme** in full there and in the
refusal, because `CONTEXT.md` gives a bare *Theme* to GDELT's subject codes, and that register sits
two rows from the reader's role.

The part that was not in the ticket. `.dark` cannot be made real by adding a class: `styles.css`
still consumed thirteen Bureau hexes, so `color-scheme: dark` would have flipped the native controls
and the scrollbars while the page went on painting Bureau's cream — worse for a dark-mode reader than
doing nothing. #76's ~150-call-site rename stays #76's; what moved forward is the *values*, as a
ten-name alias block onto the contract, by hue and by grade rather than by meaning, with three dead
names deleted. Three literal sites and one alias could not be fixed that way. `.site-header`'s
`rgba(242, 240, 233, .96)` became `color-mix(in srgb, var(--paper) 96%, transparent)`; the primary
button's hover text took `--on-accent`; and the eighteen `1px solid var(--bureau-ink)` hairlines
split, because a border does one of two jobs. Structural frames and dividers take `--rule2`, which
measures **1.49–1.81:1** against its own ground in all six — a frame you see and do not read, where
full-strength text ink drew a near-white wireframe around every card in dark at 15.20–17.35:1. The
boundary of a *control* is the one border WCAG 1.4.11 puts a floor under, so buttons and the three
field types take `--quiet` instead: **4.86–6.87:1**, everywhere. `--bench-stock` stopped mixing its
own 7% tint of ink — an invented value is a value no palette measures, against §2 rule 1 — and
aliases `--paper2`, the contract's raised surface, which is what every use of it turned out to be;
the two places it was a faint *fill* rather than a surface (a bar track, an offset block) moved to
`--rule2`, since a raised surface is lighter than paper in light and would have vanished. Quiet text
on that surface — the disabled `<select>` this ticket adds, while the save is in flight — measures
5.15–6.30:1. `styles.css` now contains **zero literal colours**. `index.html`'s single `theme-color`
moved to `#faf8f4`, which supersedes #74's reasoning above: it is now overwritten from whatever
`--paper` actually resolved to, because the moment an account can override the media query a
media-scoped `<meta>` stops being able to tell the truth.

Verified: 248 frontend tests across 17 files (22 of them new, in `theme.test.tsx`), `tsc --noEmit`
clean, build green; backend 507 passed / 11 skipped, `tsc --noEmit` clean. Two headless Chromium
probes against `vite preview`, since jsdom resolves no custom properties and so can observe none of
this: the first confirmed all six theme×mode combinations paint — paper, ground/ink at 15.20–17.35:1,
`color-scheme` flipping, the right UI face per theme — and the second exercised the **real** first
paint rather than a simulated one, seeding a token and a hint into `localStorage` and reading what
`main.tsx` left on `<html>` before React rendered: `investor`+`dark` → `terminal`/`.dark`/chrome
`#0b0e11`, `student`+`light` → `studio`/`#faf6f0`, no token → `newsroom` light, and an `auditor`
token nobody has heard of → `newsroom` rather than nothing. The third re-measured the border split
above. The ticket names no ADR; ADR-0031 already carries theme-by-role.

**#76 — shared component primitives and library stack.** The frontend now declares the settled
ADR-0030 dependencies: Base UI for headless behaviour, Phosphor for icons, Recharts for charts,
Motion for authored transitions, and TanStack Table/Virtual for bounded data surfaces. A new
`components/primitives.tsx` entry point provides token-only PageShell, List, RegisterRow, Card, Stat,
Chip, Button, Base UI-backed form fields, CitationChip, RolePanel, and Loading/Empty/Error/Refused states. Its
colocated CSS Module keeps the primitive contract independent of the legacy route stylesheet, so
existing pages retain their class-name API while later tickets can adopt the shared primitives
without a second visual vocabulary. The refused state has an explicit accessible name; loading uses
skeletons rather than a spinner, and citations remain openable links. Added one focused primitive
test. `npm run build` and the full frontend suite pass: 249 tests across 18 files. No backend changes
were needed, and full route migration is left to the tickets that consume each primitive.

**#77 — bounded lists.** `EntryList` now owns a bounded scroll frame (`30rem` high, vertical
overflow only) and a visible `Showing X of Y` summary. Paginated index lists pass their API total;
the clustering and entity-merge queues pass their server totals; graph names pass the measured
working-set count; neighbourhoods pass the endpoint bound; and timeline/article registers state
their drawn total. This covers the three dashboards, all ten Admin registers, graph names,
neighbourhoods, Story timelines, search-timeline lanes, and nested citation lists without changing
their data or pagination contracts. `min-width: 0`, `overflow-x: hidden`, and the existing page
`overflow-x: clip` keep long names, URLs, and register metadata inside the viewport. Added a
primitive assertion for the count contract. Verified with the full frontend suite (**250 tests**)
and `npm run build` (`tsc` + Vite).
