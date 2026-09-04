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
**#78 — the sign-in transition.** Login retints through a `transitionTheme` seam in `theme.ts`:
after the auth response stores the token and clears the query cache, it adds a `theme-transition`
class to `<html>` and applies the role and mode in the same frame, so the CSS block in `styles.css`
eases the already-painted signed-out surface into the signed-in product. Rules settle first
(0ms delay), washes next (160ms), accents last (300ms), each over 400ms, which lands the final
property at exactly the 700ms the class is removed at. The wordmark sits outside the sweep, so the
identity is the fixed point the product swaps around. `THEME_SWEEP_MS` is the one number, and the
CSS comment states the arithmetic that must match it.

**The first implementation of this never played, and the fix is the interesting part.** It applied
the class correctly and navigated on the next microtask. But `/login` sits under `Masthead` and
`/dashboard` under `AppShell` — different layout elements — so React replaced every node in the
subtree before a frame painted. A CSS transition needs a before-change style on a node the browser
has already laid out; on one just inserted there is nothing to interpolate from, so only the
persisting `html`/`body` background cross-faded and the staged rules → washes → accents sweep
applied to a DOM that no longer existed. The tests passed because they asserted the class lifecycle
and never that anything was still painted under it.

So the sweep became awaitable. `themeTransitionSettled()` returns a module-level promise resolved by
the sweep's own timer, pre-resolved when no sweep is running, resolved (not abandoned) by
`cancelThemeTransition` so a sign-out mid-sweep cannot strand its waiter, and already-resolved under
reduced motion. `Login.tsx` awaits it before `navigate("/dashboard")` — it holds the page it is
retinting. What pays for the hold is the other half of the ticket: `postForToken` seeds `["me"]` from
the answer it already has and fires `prefetchQuery` for the role's dashboard through a
`DASHBOARD_QUERIES` map keyed exactly as the three dashboard pages key their own query, so the wait
buys the arrival rather than costing it. The prefetch is not awaited and `prefetchQuery` swallows its
own rejection, so a failure there leaves the dashboard's `useQuery` to fetch and report on mount like
any other. Seeding `["me"]` is what keeps `DashboardRedirect` from spending a round trip *after* the
sweep deciding where to go; `register()` shares `postForToken` and so gets the prefetch but not the
sweep, which is right — §1.5 says "on successful login".

**Three defects the review found, and what they cost to fix.**

*The cross-fade cannot serve a light/dark crossing.* The sweep stages by CSS property, so `color`
rode with the accents at 300ms while `background-color` moved at 160ms. On a login where the
signed-out page is light and the account is dark, ink and paper swap ends, and easing both walks the
text through its own background: measured in Chrome at **1.15:1 for ~122ms**, bottoming at
`rgb(22,20,15)` ink on `rgb(32,34,37)` paper, against DESIGN.md §3's 4.5:1 floor. Text vanished.
The obvious repair — move `color` to the wash tier so ink and paper travel together — makes it
*worse*: travelling together they cross simultaneously and both sit at mid-grey at the midpoint,
which is ~1:1. There is no stagger that fixes it, because the two endpoints are inverted. So
`transitionTheme` now compares the incoming mode against the current one and adds
`theme-transition--mode-flip` when they differ; that block drops `color` and `background` from the
transition entirely, so those two swap outright while rules, shadows, fills and strokes sweep as
usual. Re-measured through a real login: **contrast holds at 15.2:1 across every frame of the sweep,
zero frames below AA**, with the rule still easing `rgb(201,195,182)` → `rgb(49,60,70)`. The moment
keeps its motion; only the unreadable interpolation is gone.

*The reduced-motion collapse never reached the sweep.* §7's app-wide block is
`*, *::before, *::after` at specificity (0,0,0); the sweep's selectors are `html.theme-transition *`
at (0,1,1). Between `!important` author declarations specificity decides before order, so the
collapse lost, and only the JS guard in `transitionTheme` was holding §7 up — the CSS half was
inert, and the comment above it claimed otherwise. The block now names the sweep's selectors at
equal specificity and zeroes `transition-delay` as well as the duration, since a `.01ms` transition
that still waits 300ms is not an instant swap. Verified by applying the class directly, bypassing
the JS guard: computed `transition-duration` reads `1e-05s` and `transition-delay` `0s`.

*The button narrated progress through the whole moment.* `Login.tsx` held `submitting` until after
`navigate`, so a disabled button read "Logging in…" for the full 700ms — the ticket's forbidden
spinner wearing a label, across the one moment meant to be performing rather than waiting. The
request is finished when the sweep starts, so the button now reverts to its resting "Log in" while
staying disabled, which keeps a second submit off the wire without claiming work is still happening.

**Measured in Chrome against the live stack, since "never adds perceived latency" is not assumable.**
Sampling computed styles through a real `investor@tessera.local` login: at t≈241ms `data-theme` was
`terminal` with the class on and the rule colour *between* the two palettes
(`rgb(192,193,189)`, Newsroom `#c9c3b6` → Terminal `#b3bec7`); rules finished by ~481ms; the `h1` ink
held Newsroom's `rgb(22,20,15)` until t≈567ms then eased to `#0e1418` — rules-first, accents-last,
confirmed rather than asserted. Resource timings relative to submit: `/auth/login` +5→+203ms,
`/dashboard/investor` **+214→+634ms** — requested and complete inside the sweep, ~300ms before the
navigation — and the arrived dashboard sampled as populated seeded content, no skeleton frame. The
`/auth/me` at +990ms and second dashboard call at +1196ms are react-query background revalidation
from the app's default `staleTime: 0`: non-blocking, pre-existing, deliberately left alone. A full
light→dark login end to end: mode-flip class applied by `transitionTheme` itself, sweep t=179→860ms,
navigation at 878ms, button reading "Log in" throughout, ending Terminal dark.

Reduced motion was checked in the browser too, not just in jsdom: with the media emulated, the class
never appears at all (`sawSweep: false`), `data-theme` flips at 201ms and the navigation lands at
**213ms** — twelve milliseconds later, so the awaited seam costs nothing when there is no sweep.
And the "never on subsequent navigation" condition: four client-side hops across `/stories`,
`/search`, `/graph` and `/briefs` while signed in produced no sweep and no theme change.

Font family and `--t-display` are theme tokens, so the display face and its size cut in one frame
rather than easing. That is intended: the spec's sweep is a *retint*, and cross-fading two text
layers to smooth it is the decoration the ticket rules out. The wordmark's own opt-out is
`transition: none`, which means it cuts at t=0 rather than easing — on a same-mode login that is
`#16140f` → `#0e1418`, imperceptible, and on a mode flip the whole page's ink now cuts with it, so it
reads as the anchor rather than the anomaly. Seven frames in `docs/verification/phase-3.6/`
(`78-1`…`78-7`, desktop and 390px, including the mode-flip path) hold the signed-out page, the
mid-sweep frames, and the arrival; the README there says what each has to show.

Seam tests cover the 700ms lifecycle, both reduced-motion paths, the cancelled-sweep resolution, the
mode-flip class going on and coming off, and a login integration test asserting the form still
mounted, `/api/v1/dashboard/student` already requested, and the button resting-labelled while the
class is on. Three of those were mutation-checked — swapping the await for `Promise.resolve()`,
pinning `crossesMode` to `false`, and restoring the static pending label each fail their test. Full
frontend suite **260 tests across 18 files** and `npm run build` pass; no new dependency, and #78
names no ADR.

**#79 — the rights policy relaxed, so a citation opens onto something.** The bug was a sentence in
`Publisher.ts` and a column default, and between them they emptied the product's central promise.
`mayServeText` refused the `api_content` rung under *every* Terms Class, and connector-created
publishers defaulted to `internal_only`, which is every publisher outside the eight fixture ones the
seed classifies by hand. So
`routes/articles.ts` stripped `analysisText` and `runGeneration` nulled each citation's excerpt across
the whole live corpus: Tessera fetched a body, stored it, embedded it, selected it as evidence,
reasoned over it, and then would not show the reader the sentence the claim came from. DESIGN.md §8
says a citation that cannot open is a bug rather than a style, and this was that bug at corpus scale.

The resolution is a **single axis**: the Terms Class governs *serving*, and storing a body for
internal analysis is cleared globally. That keeps every bullet of the ticket literally — `terms_class`,
`mayServeText` and `mayStoreText` all stay as modelled concepts, because they are spec §8 and they
earn marks — while making the policy one expression in one file. `licensed` now clears every rung
including `api_content`, `syndicated_excerpt` clears `feed_excerpt` alone, and `internal_only` and
`open_metadata` still clear nothing, so the vocabulary keeps its full range and re-tightening is a
`UPDATE publishers SET "termsClass" = …` rather than a code change. Both read paths call `mayServeText`
per row at read time and cache no decision, which is what makes that true. ADR-0032 records it and
what each degree of re-tightening would cost; ADR-0033 supersedes the "paid, contractually
no-training provider" that ADR-0018 and ADR-0023 both attributed to ADR-0003, because the running
`.env` is two free tiers — and the synthesis one is Google's, the provider ADR-0023 itself established
is training-eligible on the free tier. ADR-0003 never decided a paid provider; the claim accreted.

`runGeneration.ts` needed **no code change at all**. It already asked `mayServeText`; the answer
changing was the entire fix, which is the seam paying for itself. The migration
(`1755767000000-RelaxPublisherTermsPolicy`) flips the column default and moves existing
`internal_only` rows up, and its `down` restores the default only — the column carries no provenance,
so a hand-assigned `internal_only` is indistinguishable from a defaulted one and the comment says so
rather than pretending to reverse cleanly.

Two things that were not in the ticket and mattered more than most of what was. First, the storage
gate was **losing data**: `mayStoreText` refused text for `open_metadata`, and `runConnector`
implemented that by discarding the whole sighting as `rejectedByPolicy` — the open metadata went into
the bin with the body it happened to arrive attached to, so a publisher that had cleared its metadata
and nothing else contributed no Article, no entities, no edges, no timeline point. That path is gone;
the renamed test asserts three inserts, zero rejections, bodies stored, and serving still refused.
The `rejectedByPolicy` ledger — the `ItemOutcome` member, the `Counters` key, the `IngestionRun`
column, the Admin console's "Rejected" row — is deliberately **kept and dormant**, reading 0 on every
run, because it is the line a re-tightening repopulates rather than has to re-add.

Second, the trap. `EXTRACTABLE_TERMS_CLASSES` was derived as
`mayStoreText && !mayServeText(feed_excerpt)` — "we may hold the body, and the excerpt is not already
servable". With `licensed` as the default that predicate matches **nobody**, and the Readability
extraction pass would have silently become a no-op still reporting success. It now asks whether the
class clears the rung extraction *produces*:
`mayStoreText && (!mayServeText(feed_excerpt) || mayServeText(api_content))`, which leaves
`syndicated_excerpt` as the one excluded class — so the candidate-rule test dropped from three cases
to two, and its unattempted count from 3 to 2. Caught by tracing the predicate across all four
classes before editing rather than by a failing test, which is worth recording: no test would have
failed.

On the frontend the same two falsehoods were on screen. The `api_content` label said the body came
from "the GDELT DOC API" — stale since #47, since Extraction reads the publisher's own page and the
DOC API produces `metadata_only` rows — and is now **"Extracted text"**, using CONTEXT.md's own word
for the operation; it appears on exactly one surface, so nothing else drifts. The rights block's
"Redistribution" row told the reader body text "is never redistributed or republished" directly
beneath the body it was showing, which is as flat a contradiction as a page can carry. It is now
**"Terms Class"** — CONTEXT.md's own term rather than a paraphrase — over three cases keyed on the
same condition the section above already reads, since `analysisText` is absent exactly where the
class refuses to serve it. Each case is attributed to *Tessera's* classification ("Tessera classifies
this Publisher's text as cleared to show"), not to the Publisher: the class is our judgement over a
column default nobody verified, and asserting a third party's licence as fact is a verdict this
product cannot support. Copy only, inside `.record-note dd`'s existing `68ch` measure, and both
length-sensitive strings are shorter than ones the page already ships, so no browser round was spent
on a wrap a stylesheet already decides.

Verification: `npx tsc --noEmit` clean in both packages. `publisher.test.ts` was rewritten TDD-first
and went red on `mayStoreText("open_metadata")` before the policy change (2 failed / 2 passed → 4
passed). Backend, by file: publisher + stories + dashboard **50 passed**, ingestion **84 passed, 8
skipped**, and the six files that only depended on the old default — generation, seed, graphView,
entityNeighbourhood, flashcards, search — **182 passed**; the whole backend suite **509 passed, 11
skipped across 21 files**. Frontend **261 tests across 18 files** (one
new: an extracted body is named as extracted, not as API content) and `npm run build` pass. CONTEXT.md's
*Terms Class* and *Extraction* entries and AGENTS.md's rights invariant are rewritten to the new
policy, and ADR-0003, ADR-0018, ADR-0023 and ADR-0024 carry supersede notes on their `Status:` lines.

`/code-review` against `HEAD` found no correctness defect on either axis and three stale comments
still asserting the superseded policy, each at a site the change had touched but not read:
`runConnector.ts` at the very line that creates the Publisher row, `routes/dashboard.ts` describing
the Admin publisher register, and `runGeneration.ts:59` — whose frontend mirror had already been
corrected, so the two ends of one read path disagreed in prose about the same rule. Fixed with the
review. The Standards axis also argued, and it was right, that the served-case copy asserted a third
party's licence as fact when the value came from a column default nobody had verified; hence the
attribution to Tessera above.

**#80 — API hardening.** The API now assigns or honours an `X-Request-Id`, echoes it on the response,
and emits one JSON `request.completed` event with user, connector/run, Story and generation identifiers
when present, duration, status and a non-secret error code. The last-resort error handler emits the
same structured shape. BullMQ workers wrap every job with completion/failure timing and identifiers;
the ingestion, clustering and graph job summaries use the logger too. Auth traffic is limited to 30
requests per minute per app/IP by default, and synchronous Story analysis to 10 per minute per app/IP;
both windows and limits are environment-configurable and return `429`, `Retry-After` and standard
rate-limit headers. Redis-backed storage is used when configured, with the library's in-memory store
remaining for tests and a local process without Redis. The shared generation limiter covers both
Story analysis and Flashcard deck generation while leaving Flashcard reads and reviews alone.
`hardening.test.ts` covers the 429 contract, route mounts, request-id propagation and JSON completion
event. Backend build and the affected auth/generation tests pass.

**#81 — the Investor dashboard hot path is cached in Redis.** `comparableStories()` now reads and
writes one versioned JSON value through `src/lib/cache.ts`, with a 30-second TTL by default
(`COMPARABLE_STORIES_CACHE_TTL_SECONDS` can tune it). Redis failures, malformed payloads and a
missing `REDIS_URL` all fall through to the existing Postgres/evidence path, so the dashboard stays
available with Redis down. Successful ingestion, clustering, review decisions, Story merges and
seeding explicitly delete the key after their writes; expiry is a freshness bound, not the
correctness mechanism. The cached representation stores `lastSeenAt` as an ISO string and is
validated before it reaches the route.

Measured on the live seeded corpus (10 comparable Stories, six reads): uncached direct reads had a
**101.22 ms median**; warm Redis reads had a **2.28 ms median** (97.7% lower). The first Redis read
still pays the normal computation and populates the key. `backend/tests/cache.test.ts` covers JSON
round-tripping/TTL, explicit deletion, failing cache clients, malformed payloads, and the comparable-Story miss/hit
path; backend build and the affected dashboard tests pass.

**#82 — Flashcards own their answer and frozen citations.** Flashcards now carry an answer and
private citation rows into an immutable EvidenceSet, while cards made from completed analyses are
backfilled from their existing claims. `POST /flashcards/search` selects accepted Story members
only, freezes the top 5/10/20 matches, and generates cited cards with one-word, one-line or full
answer lengths. Students can list every card, open, edit, delete, and inspect review history;
the existing SM-2 due session and analysis entry point remain intact. The Student study route
adds search generation controls, an all-cards register, and keyboard grading. Backend and frontend
builds pass; the flashcard suite now has 21 tests, including search generation and CRUD/history coverage.

**#83 — Flashcard lists agree with the cards a Student can read.** The full-card endpoint now has a
bounded, paginated envelope with due/upcoming status and question/answer search filters, while
preserving owner scoping and the existing `cards` field. Study renders those controls and page
navigation. Summary, due-session, and full-list queries share a citation-validity predicate against
each card's frozen EvidenceSet, so orphaned citations cannot inflate dashboard counts or create a
"due" card that the reader later drops. Added regression coverage for citation damage and list
filtering/pagination; the focused backend suite has 23 passing tests.

**#84 — The Flashcards surface.** Flashcards is now a first-class Student destination in the shell,
with a Phosphor icon and a bounded study workspace. The page leads with the due session: one prompt,
an explicit reveal action, cited answer, Story link, four SM-2 grades, and keyboard support (Space to
reveal, 1–4 to grade). A separate full-deck register makes every card findable, shows due/upcoming
state, supports status and text filters, paginates through the existing API envelope, and keeps edit,
delete, and study-history actions in place. Search generation is grouped into a dedicated form with
5/10/20 card-count and one-word/one-line/full answer-length controls; success, error, loading, empty
deck, and nothing-due states remain distinct. The new Studio treatment is token-only, responsive at
the existing 720/560px breakpoints, and keeps long registers bounded. Added a focused full-deck
interaction test. Frontend verification: **262 tests across 18 files**, `npm run build`, and the
Impeccable detector all pass.
The non-Student route now renders the shared Refused state before any card query, keeping all four route states distinct.

**#85 — Publisher leaning, reproduced from AllSides.** `Publisher` gains a second classification
axis and its first that is somebody else's judgement rather than Tessera's: `leaning` (AllSides'
five-point vocabulary, stored as they publish it) plus `leaningSource`. ADR-0035 records the
decision and the reasoning that reconciles it with the retired design system's objection — a leaning
is *reproduced*, never inferred, so it is a cited claim about a publisher and the same shape as
everything else the product displays.

The invariant is structural rather than conventional. Three CHECK constraints: the vocabulary is
pinned, `("leaning" IS NULL) = ("leaningSource" IS NULL)` so half a claim cannot be stored, and
`leaningSource` is limited to raters Tessera reproduces — without that third one the pairing is
satisfied by citing ourselves, which is an inferred verdict wearing a citation as a disguise and
exactly what the ticket forbids. `toPublicLeaning` is the one shape a rating leaves the API in and carries
the source *inside* the value rather than beside it, so no surface can arrange the parts into a
verdict with nobody's name on it — a row whose source key is unrecognised reads as unrated instead.
`leaningFor(domain)` in `backend/src/lib/publisherLeaning.ts` is the single writer, matching on the
dot boundary and the longest rated suffix so `edition.cnn.com` inherits `cnn.com`'s rating while
`notfoxnews.com` inherits nothing.

Ratings reach publishers by two paths sharing that one function: `resolvePublisher` rates a
publisher as ingestion discovers it, and a new `seedPublisherLeanings()` pass converges every row a
database already holds — down as well as up, so a withdrawn rating leaves Tessera too. The migration
deliberately backfills nothing: restating eighteen third-party claims in SQL would give them a second
home to drift from, and `npm run seed` is the same catch-up path `AddPublisherTermsClass` used.

The table is eighteen domains, each read off AllSides' own per-source page on 2026-09-04 rather than
recalled — a remembered rating would be exactly the invented claim about a real outlet the feature
exists to prevent. Two checks during that reading changed what shipped: **The Guardian is rated
Left, not Lean Left**, and **AP is Lean Left, not Center**. Spread: 1 left, 7 lean left, 3 center,
3 lean right, 3 right. Five of the ten seeded RSS feeds resolve to rated outlets and five
(Ars Technica, NASA, Krebs, ScienceDaily, TechCrunch) do not, so the demo shows both states
side by side without arranging for it.

Two surfaces show it, and neither can show a rating without its credit. The Admin publishers
register gains a **Leaning** cell beside Terms, with one attribution line for the register that
renders nothing when no row carried a rating. The Article record's rights-and-provenance ledger
gains a **Publisher leaning** entry: the mark, one line saying Tessera reproduces ratings and rates
no publisher itself, and the licence. The mark is five ticks — the rated one taller *and* coloured
from `--left --centre --right`, so DESIGN.md §2 rule 3 holds with every colour stripped. Unrated
ticks take `--quiet` rather than `--rule2`: the scale is what makes the mark legible as a position,
which is meaning, and §3 measures `--rule2` at 1.49–1.81 against paper — right for a hairline
between blocks, wrong for a carrier of meaning. The 5→3 collapse onto the spectrum axis is decided
once at the read seam and served, so #86's spectrum and this mark cannot disagree about which side
a rating counts on.

One residual is named rather than hidden: the rater's *name* is inside the rating's value and cannot
be dropped without deleting the rating, but the licence line is a separate component rendered once
per surface. Both surfaces render it and both are tested; a future third surface could forget it.
ADR-0035 records that as a convention rather than a constraint.

The frontend pass ran through the `impeccable` skill, and two of its checks changed what shipped:
the tick scale moved off `--rule2` (1.49–1.81 against paper) onto `--quiet`, and the leaning's
context line moved out of the global `styles.css` into `primitives.module.css` beside the mark it
explains, per ADR-0030.

Verification: backend `npm test` and frontend `npm test` + `npm run build` green — 265 frontend
tests across 18 files, and 10 new backend assertions at the leaning seam plus route, ingestion and
seed coverage including all three CHECK constraints. The full backend suite is flaky on this
machine under concurrency and was so before this ticket: the clean tree at `305630e` fails three
tests across two files under the same command, this branch one, and every one of them passes in
isolation.

**#86 — Coverage spectrum and blindspots.** Story reads now carry a `coverageSpectrum` computed from
accepted Story membership, counting Articles (not Publishers) across the three bands and retaining
unrated coverage as its own count. The calculator collapses AllSides' five ratings through the same
band vocabulary as the Publisher leaning mark, and flags a blindspot when one rated side reaches
80% of rated coverage; unrated-only coverage never becomes a blindspot. Story lists compute the
field in one bounded Article query for the page, while Story detail reuses its already-loaded
members.

The shared `CoverageSpectrum` primitive renders a labelled segmented bar, counts every band,
states unrated Articles, and names a blindspot in words so colour is not the only signal. It is
present on the Stories index and Story detail, with the token contract's `--left`, `--centre` and
`--right` accents. Added three focused calculator tests covering collapse, blindspot threshold and
the unrated case. Verification: frontend **265 tests**, `npm run build`, backend build, and the
focused backend spectrum suite pass.

**#87 — A market data provider seam, with a Mock beside it.** `backend/src/market/` is the third
instance of ADR-0003's pattern and needed no new abstraction to be the third: `createMarketProvider()`
resolves `TiingoMarketProvider` or `MockMarketProvider` from env by the same rule
`createEmbeddingProvider` and `createSynthesisProvider` use — an explicit `MARKET_PROVIDER` wins,
otherwise a present `MARKET_API_KEY` infers the real provider and no key means the Mock. ADR-0036
records the choice and, per ADR-0033, the criterion behind it: access and cost, because this is a
project and not a business.

**The provider is Tiingo, not the Finnhub the spec names, and the correction is the most useful thing
in this ticket.** It shipped on Finnhub first. Checked against a real free-tier key the same day,
`GET /quote` answers 200 with live data and `GET /stock/candle` answers **403 `You don't have access
to this resource`** — so Finnhub free is real-time quotes only, and §4's in-house indicators (#88) had
no price series to compute over. A survey against three constraints (an official published tier, a few
dozen tickers, email-only signup) found Tiingo, and two facts decided it. **Alpha Vantage's free tier
is unadjusted prices only** — adjusted close is premium — and an SMA-50 over unadjusted prices reads a
stock split as a 50% crash that never happened, which is a silent wrong answer in exactly the surface
#88 builds. And **Tiingo answers a comma-separated list of tickers in one request**, so a fifty-ticker
watchlist refresh is one call against a fifty-an-hour limit rather than fifty; the tightest-looking
number in the comparison is not a constraint at all.

Then the useful part: Tiingo's `/iex/` serves the *quote* too, returning the same numbers Finnhub did
for the same Ticker in the same minute — `tngoLast` 328.21 against `c` 328.21, `prevClose` 324.96
against `pc` 324.96. So the question stopped being "which vendor supplies the series Finnhub cannot"
and became "is there a reason to keep two vendors", and there was not. **Finnhub was dropped
entirely** — one key, one rate limit, one set of terms. The swap touched the provider class and
nothing else: the seam, the cache, the value shape, the selection rule and every test around them
survived, which is ADR-0003's interface earning its keep for the third time. It also *deleted* code:
the `price <= 0` guard existed only to read Finnhub's zeroed-200 as the 404 it was, and Tiingo's empty
array means what it looks like.

Four decisions inside the seam are worth more than the selection function.

**A quote carries the name of who produced it.** `source: "tiingo" | "mock"` lives *inside* the
`Quote` rather than beside it, the same shape ADR-0035 gave a publisher leaning. It matters more here:
a Mock price is a plausible-looking number, and a plausible-looking number is exactly the kind that
must never reach a screen as though a market set it. The Mock's prices are derived from a hash of the
Ticker rather than read from a checked-in table — a table of prices is a claim about what real
companies are worth and is stale within a day — and its `asOf` is fixed rather than `now()`, so two
calls cannot disagree about when a demo's price was struck.

**An unknown Ticker is an answer; an outage is not, and only the first is cached.** The provider
returns `null` for a Ticker nothing trades under and *throws* when it cannot be reached. Without that
split the seam is wrong in both directions: an Entity carrying a Ticker that will never resolve gets
re-asked on every page read, spending the hour's whole budget on a settled row, and a thirty-second
outage gets pinned on screen for the full TTL after the provider came back.

**The cache is the rate control, not a freshness bound.** `quote()` reads and writes #81's Redis seam
at `tessera:quote:v1:<TICKER>` with a 60-second TTL (`MARKET_QUOTE_CACHE_TTL_SECONDS`). The seam fails
open as it did for #81, so with `REDIS_URL` unset or Redis down every call reaches the provider and the
feature still works — slower and closer to the limit, never broken. That is worth stating precisely:
"50/hour is safe" is a Redis-up claim.

**What "never called from a render" actually rests on, since the review pushed on it.** The browser
half is true by construction — this is backend-only code no component can import. The half that is
*not* enforced is a route calling `createMarketProvider()` and going round the cache: the factory is
exported because ADR-0003's pattern and #87's own Done-when both name it, and there is no lint script
in this repo to stop the wrong door being used. ADR-0036 §5 records that as a convention rather than
asserting it as decided, the way ADR-0035 recorded its licence-line residual. #89 is the first ticket
in a position to get it wrong.

**The token goes in a header, and Tickers are validated before they are interpolated.**
`Authorization: Token …` rather than a query parameter keeps the key out of request logs and out of any
redirect target (`redirect: "error"`, as the synthesis transport already does), and `normalizeTicker`
gates a string before it becomes a URL query or a cache key — a Ticker arrives from an `Entity` row an
Admin edits (#89). The seam says **Ticker** throughout, CONTEXT.md's own term, and leaves `symbol`
where it belongs: a vendor's name for the field on the wire. There is no retry loop: retrying into a
rate limit spends the budget the cache exists to protect, and a 5-second `AbortSignal.timeout` bounds
the call.

**The rights position is stated rather than dodged.** Tiingo's free tier is *personal, non-display*
use — and no free market-data tier permits display, because that is how market data licensing works;
Twelve Data just puts a $29/mo price on the same clause. ADR-0036 accepts it on exactly the argument
ADR-0033 made about free-tier LLM providers — public data, no user PII, one demo machine, no
commercial exposure — and declines to claim a licence the project does not have. Two ADRs now share
one criterion and one honest sentence.

**What #88 and #89 inherit.** `MarketProvider` gains `dailySeries()` when the ticket that needs it
lands, not before. #88 must compute over `adjClose` rather than `close`, or a split silently becomes a
crash. #92's watchlist should use the batch form rather than a loop over `quote()`, which is the whole
reason the rate limit is comfortable.

`vitest.config.ts` pins `MARKET_PROVIDER`, `MARKET_API_KEY`, `MARKET_API_BASE` and
`MARKET_QUOTE_CACHE_TTL_SECONDS` empty beside the embedding and synthesis keys, so no test run reaches
a live provider — or a developer's own TTL — from their `.env`. `fakeRedis()` moved out of
`tests/cache.test.ts` into `tests/fakeCache.ts` so the market tests could reuse it rather than copy it,
and typing its parameters cleared three pre-existing `tsc` errors. Reading a TTL from env moved into
`cache.ts` as `ttlFromEnv`, which the comparable-Stories key now shares.

**Four things the `/code-review` pass changed**, before the provider swap: the seam was renamed off
`symbol` onto **Ticker** (CONTEXT.md's term, and the glossary entry written for this ticket had
imported the wrong word three lines below the right one); `createMarketProvider()` was hoisted out of
`quote()`'s `try`, where a bad `MARKET_API_BASE` had been degrading into the same empty panel an
unknown Ticker gives instead of failing loudly; `MARKET_QUOTE_CACHE_TTL_SECONDS` got its pin; and
`open`, `high` and `low` came off `Quote`, since #88's indicators need a price *series* rather than one
day's OHLC and nothing was going to read them.

Verification: 11 assertions in `tests/providers.test.ts` covering selection, inference, refusals, the
https requirement, the Tiingo mapping, the empty-response reading, Mock determinism, the cache hit and
its tunable TTL, the cached-unknown/uncached-outage split, the loud misconfiguration and Ticker
validation — `tests/providers.test.ts` and `tests/cache.test.ts` green, and `tsc --noEmit` down to the
one pre-existing `hardening.test.ts` error. The full backend suite is 549 passing with one failure in
`clustering.test.ts` that passes in isolation — the concurrency flake #85 already recorded on this
machine, unrelated to this seam, which touches no clustering path. No frontend in this ticket, so no
`impeccable` pass; the market panel is #89.

**#88 — Technical indicators, computed in-house.** `backend/src/market/indicators.ts` holds three
pure functions over a series of closes, oldest first: `simpleMovingAverage`,
`relativeStrengthIndex` and `volatility`. The module has **zero imports** — the ticket's "no I/O in
this module at all" is structural rather than a convention, so it cannot drift into reaching for a
provider.

**The fixture is the point of this ticket, and it took the longest.** An indicator test that computes
its expected values with the same algorithm proves only that the code agrees with itself. RSI is
tested against **Wilder's published 14-period worked example**, reproduced from outside this repo:
`relativeStrengthIndex` returns 70.464 for its first computed point, matching the published table
exactly. Getting there surfaced a real detail — the published series is quoted to **two** decimals,
and at four decimals it cannot be reproduced (max divergence 0.123 against 0.085). The two-decimal
input matches the first value to the digit and drifts by at most 0.085 over nineteen periods, which
is the published table's own intermediate rounding carried forward by Wilder's smoothing. The
volatility fixture is likewise computed independently: six alternating ±10%/−9.09% log returns have a
sample deviation of 0.104407, annualising to **165.7411%**.

Three decisions inside the arithmetic.

**A flat series reads as RSI 50, not 100.** The usual shortcut — no losses means 100 — would call a
motionless price extremely overbought, so the no-movement case is answered before the divide. A
series that only rises is still 100 and one that only falls is still 0; both are tested.

**Volatility is the annualised sample deviation of daily *log* returns.** Log returns because they
compose additively, which is what makes scaling by √252 valid at all; the sample deviation (n−1)
because a price history is a sample. Three closes minimum, since two returns are the fewest that have
a spread between them.

**Every function answers `null` rather than a number it cannot stand behind** — a series shorter than
the window, a period that is not a positive whole number, or a series with a hole in it. The hole
case is checked across the **whole series, not just the window**: a vendor row can arrive missing, and
a `NaN` rendered silently as a number is the failure worth engineering against. A displayed indicator
is a claim.

**Feed these `adjClose`, never `close`**, and the module says so at the top. Over raw closes a
2-for-1 split reads as a 50% crash and every indicator downstream inherits it. Measured on the live
AAPL year: the two SMA-50s differ by 0.17 from **dividends alone**, with no split in the window at
all.

Checked against real data as well as fixtures — 252 live Tiingo bars for AAPL gave SMA-50 314.08,
SMA-200 283.17, RSI-14 63.48 and 25.02% volatility, putting the price **4.50% above its 50-day
average**. Spec §4's own illustrative sentence is "trading 4.4% above its 50-day average", so the
worked example in the spec and the running code agree to within a decimal.

Verification: 14 assertions in `tests/indicators.test.ts` covering the published RSI fixture and its
forward smoothing, the rising/falling/flat cases, the annualisation fixture, the monotonicity of
volatility in swing size, and every refusal — short series, bad period, holed series. Backend suite
**568 passing**; the one failure is `clustering.test.ts`'s medoid test, now filed as **#107** (a
Story's name is decided by a random UUID tie-break) rather than left as folklore about concurrency —
it is unrelated to this ticket, which touches no clustering path.

**#89 — Tickers on Entities and the Investor Story market panel.** Entities now carry a nullable
Ticker constrained to organizations, with a migration-level format check. A small curated mapping
converges well-known organization names to tickers during entity resolution and seed catch-up; the
fictional Curated Corpus remains unrated and unmarketed until live GKG organizations resolve.

The market provider seam now supplies adjusted daily bars alongside quotes. The Story read joins
accepted organization annotations through terminal aliases, limits the panel to Investors, and
returns `null` when no resolved organization has usable market data. Quote, adjusted-close chart,
SMA-50, RSI-14 and annualized volatility are served from the existing Mock/Tiingo seam, so render
code never reaches a provider directly. The Investor panel uses the existing RolePanel primitive,
Recharts and Phosphor icons, and states the provider plus quote timestamp beside the data.

The read keeps its empty and unavailable states separate: a missing Ticker (or a provider's
confirmed no-data answer) is `marketStatus: "empty"`, while a failed quote or history request is
`"unavailable"` and the Investor panel offers the shared retry treatment. Historical bars use the
same Redis seam as quotes, with a one-hour `MARKET_SERIES_CACHE_TTL_SECONDS` default, so opening a
Story cannot spend Tiingo's free-tier budget on repeated 370-day requests. The bounded eight-row
join carries `marketTotal`; the panel says `Showing n of m`, shows both dollar and percentage day
change, and colours the chart by direction.

Verification: focused backend market-panel/provider tests (29 assertions), frontend Story-detail
market rendering coverage, backend and frontend builds pass. The full frontend suite remains green;
the full backend suite retains the unrelated clustering medoid flake tracked as #107.

**#90 — Generated market read without advice.** Investor Story detail now offers an explicit
market-read action. The backend freezes accepted Story reporting in an EvidenceSet, combines it with resolved Ticker quotes and
in-house indicators, asks the existing synthesis provider for one concise read, and validates its
JSON, citations and investor-language guard before returning it. Reads are cached in Redis by a
SHA-256 of the Story inputs plus provider identity, so repeated requests do not pay for another model
call. Advice-shaped text is refused through the same matcher used by analysis; focused tests cover
that refusal and cache reuse. The Mock provider returns a clearly labelled deterministic read for the
offline demo. Verification: backend and frontend builds pass; focused market-read and market-panel
tests pass. Full suites retain their pre-existing timing flakes on this machine.
