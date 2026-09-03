# 31. Bureau retired; the product is themed by role

Date: 2026-09-03
Status: Accepted
Withdraws: the "Evidence Registration Bureau" design system — `DESIGN.md` as it stood before this
date, and the rollout that carried it across the app in #28–#37. No ADR ever recorded that system,
which is part of what went wrong: its rules were never argued anywhere they could be re-read.
Depends on: ADR-0030 (frontend library stack), the Phase 3.6 spec §1, the rewritten `DESIGN.md`

## Context

Bureau was a deliberate system, not an accident, and it was built on a real insight: Tessera's
subject is provenance, so its interface should look like a place where evidence is registered and
stamped. The four page archetypes came from it, so did the four mandatory UI states, and so did the
rule that what two pages both draw lives in one shared register. Those were the right calls.

The mechanism it chose to get there was a list of prohibitions: no ambient depth, no decorative
motion, no colour that does not carry meaning, no icons. Every rule is individually defensible.
Together they answered every design question with "don't", and left none of them answered with
"do".

What that produced, measured at the commit before this one:

- Arial on `#f2f0e9`, across every route.
- **One** `@keyframes` in the entire application (`registration-arrives`, on the pending state).
- **Zero** icons — no `<svg>` and no icon import anywhere in `frontend/src`.
- Coverage bars hand-drawn in CSS from an inline `--share` custom property.
- Five runtime dependencies, and a 967-line global stylesheet.
- **206 of those lines — 27.6% of the sheet by bytes — were `.design-bureau`**, styling a
  prototype at `/design-prototype` that no route in the app linked to.

That last number is the diagnosis in one figure. Everything the system was *ambitious* about — view
transitions, six more keyframes, offset registration shadows, a masthead that inked itself in —
lived in the prototype, behind a URL a reader had to be told about. The rules were strict enough
that the ambition could not survive contact with a real route, so it pooled in the one file no
reader would ever load. A full walkthrough of the running app returned one verdict: the whole
frontend needs an overhaul.

The lesson is not "be louder". It is that **a design system made only of prohibitions produces
nothing.** A prohibition can only ever remove a candidate; it cannot generate one. A system needs a
positive brief — these faces, these palettes, this motion, for this reason — before its "don'ts"
have anything to constrain. Bureau's don'ts are mostly still in the new system's §10; what changed
is that they are now the last section rather than the whole document.

## Decision

**Withdraw Bureau. The product looks like who you are.**

Theme is a property of the signed-in role, not a user preference: Admin gets Newsroom, Investor gets
Terminal, Student gets Studio, and signed-out surfaces wear Newsroom light as the system's own
voice. Each theme exists in light and dark — six palettes — and each keeps its own dark ground,
because a shared dark ground would erase role theming exactly when it is being demonstrated.

The mechanism is **one token contract**: every palette declares the same custom properties and
differs only in their values, so a component reaching for `var(--agree)` is correct under all six.
That is what makes three faces cost one implementation. Without it, theme-by-role would mean three
component trees, which is a far worse trade than the austerity it replaces. The contract, the
palettes with their measured contrast ratios, the type scale and the component rules are in
`DESIGN.md`; the libraries that draw them are in ADR-0030.

**Deleted here** (#73): the `.design-bureau` block, `src/versions/BureauPrototype.tsx`,
`src/versions/bureau.tsx`, the hardcoded fixtures in `src/data.ts`, and the `/design-prototype`
route. The four bureau-only keyframes and the `evidence-morph` view-transition rules went with them,
leaving the app's one real keyframe and the global `prefers-reduced-motion` guard, which is not
Bureau's and stays.

**Kept from Bureau**, because it was right the first time: the four archetypes (Index, Record, Form,
Dashboard) under their own names, the four mandatory UI states per route, the shared-register
principle, the 1600px measure, and the breakpoints `DESIGN.md` §6 inherits — 1050 and 560 — so the
new verification screenshots stay comparable to the old ones.

**Kept as evidence**: `docs/verification/bureau-rollout/`. The rollout happened, it was verified at
two widths, and deleting the proof would make the history unreadable. Being superseded is not the
same as having been sloppy.

## Consequences

- `DESIGN.md` is authoritative again rather than aspirational. Every rule in it is now something to
  build, which is checkable; "no ambient depth" never was.
- The stylesheet is 27% smaller before a single new page is written, and every line left in it is
  reachable from a route.
- Role theming becomes a demo asset. Signing in as three users shows three products, which is the
  clearest possible statement of what the role model is for — and ADR-0004's three roles finally
  have a visible consequence in the interface, not only in what each one is permitted to do.
- Dark mode is now a requirement in six variants rather than a nice-to-have in one. Contrast has to
  be measured per palette; `DESIGN.md` carries the ratios and already records two corrections to the
  designer's values for WCAG 2.2.
- A per-account light/dark override needs a column on `User` (#75). Role→theme needs no storage: the
  role is already in the JWT.
- Anything that reads `--proof-blue`, `--bureau-ink` and their siblings still works, because those
  root tokens were promoted out of the prototype's namespace long ago and are the app's only colours
  until #74 replaces them wholesale. The names are Bureau's; the contract that replaces them is not.
- The risk this ADR accepts is the opposite failure: three themes plus two modes is six times the
  surface to get wrong, and role-conditional theming can drift into role-conditional *behaviour*,
  which is a permission model, not a palette. The token contract is the guard — same components,
  same words, same layouts; only the values change.
