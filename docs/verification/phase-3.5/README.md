# Phase 3.5 exit criterion — verification sweep (#72)

ADR-0022's exit criterion for Phase 3.5, checked for the first time: a 50–200-node graph and a
timeline rendering. Captured at the same two widths as the bureau sweep (`1050-*.jpg` renders at
1035px, `560-*.jpg` at 545px, full page height) against a **live** corpus rather than the seeded one
— 17,673 Articles and 1,065,196 GKG annotations, since ADR-0028 makes the graph firehose-derived and
a seeded corpus cannot clear the promotion floor. jsdom does no layout, so nothing here is reachable
from the automated suite.

| File | Surface | What it has to show |
|---|---|---|
| `*-graph.jpg` | `/graph` | 60 nodes / 293 edges inside the 50–200 band, drawn by Cytoscape, with the corpus stated on screen |
| `*-graph-entity.jpg` | `/graph/entities/:id` | One Entity's neighbourhood at depth 1 — focus plus 59 one-hop neighbours, 324 edges |
| `*-story-timeline.jpg` | `/stories/:id` | Reporting points and both analytical events on one axis |
| `*-search-timeline.jpg` | `/search/timeline?q=iran` | A master axis with three Story lanes bucketed against that shared axis |

`1050-graph-entity-citations.jpg` is viewport-sized, with the edge-citation drawer open. It is
evidence twice over: the drawer resolves "the 20 most recent of 207 reports", and it is also the
capture of the layout defect #72 turned up — every headline in it collapses to one character per
line. There is no 560 counterpart, and that is the point: `@media (max-width: 560px)` collapses
`.entry` to a single column, so the defect cannot appear at that width.

Not captured here, asserted programmatically and written up in
`docs/repo-state/phase-3.6-product-overhaul.md`: every one of the 59 neighbours
incident to the focus with zero non-neighbours, membership *labelling* rather than filtering a graph
citation (ADR-0028's documented exception), all three worker tick types draining live, and
`SETUP.md`'s deploy path running from empty — 26 migrations and a clean seed into a scratch
database, since dropping the volume would have destroyed the only corpus that can satisfy the
criterion.
