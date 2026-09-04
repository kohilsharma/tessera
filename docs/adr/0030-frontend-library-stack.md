# 30. Frontend library stack: headless behaviour, our own CSS

Date: 2026-09-03
Status: Accepted
Depends on: ADR-0022 (build order), the Phase 3.6 spec (`docs/phase-3.6-spec.md`), `DESIGN.md`

## Context

Phase 3.6 rebuilds the frontend around three role themes over one token contract. The previous
build had **five runtime dependencies total** and hand-rolled everything: CSS bar charts driven by
an inline `--share` custom property, zero icons, one keyframe, and a 968-line global stylesheet of
which a third was unreachable. That asceticism is the thing being corrected.

The course fixes only Express, PostgreSQL, TypeORM, React and JWT. Everything above that is open,
and this is a course project rather than a business, so libraries are chosen on fit and access
rather than on licensing for commercial resale.

Picking these once, here, matters more than the individual picks: a component library chosen
per-ticket produces three vocabularies in one app.

## Decision

### Component behaviour — **Base UI** (`@base-ui-components/react`)

Unstyled primitives: dialog, popover, select, tabs, tooltip, menu, switch, and the focus/keyboard/
ARIA behaviour underneath them.

Base UI reached a stable v1.0 in 2026, is built by the people behind Radix, Floating UI and
Material UI, and is the more actively maintained primitive layer now that Radix's updates slowed
after the WorkOS acquisition. shadcn/ui has defaulted to it since July 2026.

Rejected: **Radix** (same shape, slowing); **React Aria** (hooks-first and more verbose than we need
— worth revisiting only if we hit a pattern Base UI lacks, such as a date picker); **MUI, Chakra,
Ant Design** (styled libraries would fight a six-palette token system all the way down).

### Styling — **CSS Modules** over the token contract

Vite supports CSS Modules with no added dependency and no build-step change. Co-locating a
component's styles with the component is the direct fix for a 968-line global sheet.

Rejected: **Tailwind**. It would add a class vocabulary and a migration for no capability we lack —
our theming is already CSS custom properties, which is what Tailwind v4 itself themes with. Its
strongest pull is shadcn/ui, whose value is *styled* copy-paste components that we would restyle for
three themes on arrival. Rejected: **styled-components / emotion**, for runtime cost we have no
reason to pay.

### Charts — **Recharts**

Composable React components, SVG, straightforward to drive from CSS custom properties, which is what
lets one chart wear three themes. Our datasets are small by construction — 60 graph nodes, 60
timeline buckets, five sectors, one price series — so SVG-node-per-point, Recharts' real limitation,
never binds.

Rejected: **ECharts** (~1MB, earns it above ~100k points, which we will never have); **Chart.js**
(canvas and imperative, harder to theme per role); **visx** (~15KB and maximum control, but it costs
developer time we would rather spend on the product — reach for it only if a bespoke mark is needed
that Recharts genuinely cannot draw).

### Graph — **keep Cytoscape**, add `cytoscape-fcose` and `cytoscape-popper`

Cytoscape is already installed and already rendering the graph. It is the richest all-in-one
toolkit and correct for midsize graphs, which at a 60-node view cap is exactly what we have. The
complaint about the graph is configuration — `autoungrabify`, `autounselectify`, `animate: false`,
no hover, no tooltip — not the renderer.

Rejected: **sigma.js** and **react-force-graph** (WebGL, earning their keep from roughly 5,000
nodes upward). Rejected again, for the record: **Neo4j** (ADR-0019) — a graph database changes
nothing about rendering.

### Motion — **Motion** (`motion`), used via `LazyMotion` + `m`

Best-in-class for enter/exit and layout transitions, which is precisely the sign-in transition and
list reordering. The `LazyMotion` + `m` pattern ships ~4.6KB initially and loads features on demand,
so the cost is proportionate.

Rejected: **GSAP** (~23KB core; its strengths are scroll-driven and timeline-heavy work we do not
do); **react-spring** (physics we do not need); **plain CSS alone** (enough for the sign-in sweep by
itself, but not for list enter/exit and shared-layout transitions).

### Icons — **Phosphor** (`@phosphor-icons/react`)

Already the design canvas's own choice. Regular / bold / duotone weights map cleanly onto the three
themes' different densities.

### Tables and long lists — **TanStack Table**, and **TanStack Virtual** only where measured

The admin registers need sorting and pagination; TanStack Table is headless, so it wears our tokens.
Virtualisation is deliberately *not* the default answer to unbounded lists — scroll containers and
pagination handle almost all of them. Virtualise only a list measured to be slow.

### Backend — almost nothing new

- **Redis cache**: `ioredis` is already installed (BullMQ uses it). No new dependency.
- **Market data**: `undici` is already installed. No vendor SDK. (Named Finnhub here; the provider
  is Tiingo — ADR-0036. The point stands either way: no SDK, just `fetch`.)
- **Structured logging**: add `pino` + `pino-http`.
- **Rate limiting**: add `express-rate-limit`, with `rate-limit-redis` so the limit is shared across
  processes rather than per-instance.

## Consequences

- One vocabulary across the app: behaviour from Base UI, marks from Recharts, motion from Motion.
  A ticket that reaches for something else needs a reason on the issue.
- Themes stay cheap. Every library chosen here is unstyled or CSS-variable-driven, so adding a
  seventh palette would be a token block, not a component fork.
- Bundle stays modest: Base UI is tree-shaken per primitive, Motion is lazy-loaded, Recharts is the
  one substantial add.
- The backend grows by two small dependencies, both closing gaps named in spec §22.1.
- If Base UI turns out to lack a pattern (a date picker is the likely one), React Aria is the
  documented escape hatch for that component alone — not a second general vocabulary.
