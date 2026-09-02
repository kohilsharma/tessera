import type { GkgAnnotationKind } from "../entities/GkgAnnotation";

function envNumber(key: string, fallback: number, { min, max }: { min: number; max: number }): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

// Separate from envNumber because a similarity is not an integer, and `Number.isInteger`
// would reject every value in range. Exclusive of 0: a threshold of zero would propose
// every pair of names of the same kind.
function envFraction(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${key} must be a number greater than 0 and at most 1, got "${raw}"`);
  }
  return value;
}

// CONTEXT.md "Entity Promotion Floor" (ADR-0028): the number of distinct Articles a
// surface name must appear in before it is an Entity at all. This is the knob that
// makes "bounded" a property of the data rather than a cleanup job — measured on
// 2026-09-01, one GKG window carries 2,044 distinct person names but 133 seen in five
// or more Articles, and person plus organization at this floor give 195 nodes, which
// is ADR-0019's 50–200 bound arriving from the data instead of from a guess.
//
// Err high rather than low: the dominant noise the measurement found is mistyping and
// truncation (`Los Angeles` reported as a person, `Australian Associated` cut short),
// which no amount of matching fixes and which the floor removes for free — a mistake
// is rarely made five times.
export const ENTITY_PROMOTION_FLOOR = envNumber("GRAPH_ENTITY_PROMOTION_FLOOR", 5, { min: 1, max: 1000 });

// ADR-0028's second bound, and the one ADR-0019 left out: 195 nodes carry 4,833 pairs
// sharing two or more Articles, so bounded nodes do not imply a bounded picture. Each
// Entity keeps its strongest co-occurrences and nothing else.
//
// 25 because a neighbourhood is something a person reads: past a couple of dozen
// neighbours a node's surroundings are a hairball whatever the layout does with them.
// Applied from *both* ends — a pair inside either Entity's strongest 25 is kept — so a
// node's own strongest neighbour is never missing because it was that neighbour's 26th.
export const EDGES_PER_ENTITY = envNumber("GRAPH_EDGES_PER_ENTITY", 25, { min: 1, max: 500 });

// #68's two bounds, on the *read* side. The pass's bounds keep the stored graph
// bounded; these keep one screen of it legible, which is a smaller number. The pass
// holds 195 nodes at 25 neighbours each — every one of them worth storing, and all of
// them at once worth nothing to look at.
//
// Not merged into the pass's bounds, and not derived from them: what a screen can hold
// is a fact about a screen, and the neighbourhood #69 draws around one Entity will want
// the same ceiling over a different selection. Held here so a route never carries a
// number of its own, and so `GET /graph` can take no parameters at all — a bound a
// caller cannot name is a bound a caller cannot widen.
//
// 60 nodes: at ADR-0019's 200 a force layout has more labels than gaps, and the reader
// is left panning a hairball to find the name they came for. The most present 60 of the
// working set is a picture; the page states the other number beside it, so a reader is
// never left thinking 60 is all there is.
export const VIEW_NODE_CAP = envNumber("GRAPH_VIEW_NODES", 60, { min: 1, max: 200 });

// 6 neighbours: 60 nodes at 6 is at most ~180 edges, which is a graph a person reads a
// path through. Applied from both ends, as the pass's bound is, and for the same reason
// — a node's strongest neighbour is never dropped for being that neighbour's seventh.
//
// The pass's own bound is the real ceiling above this: past `EDGES_PER_ENTITY` there is
// nothing stored to return.
export const VIEW_EDGES_PER_ENTITY = envNumber("GRAPH_VIEW_EDGES_PER_ENTITY", 6, { min: 1, max: 100 });

// #68's third bound — depth — had no constant while the global view was the only reader:
// it selects its nodes by presence and draws the edges *among them*, never traversing out
// from a node, so there was no hop to widen. #69's neighbourhood is the view that walks
// outward, so the bound is real now and lives here with the other five.
//
// Not an env knob, which is why it is a plain constant among the `envNumber` ones: one hop
// is what "neighbourhood" means. Two hops from a well-reported name is most of the graph —
// the neighbours' own neighbourhoods overlap — so a second hop is a different picture
// rather than a wider one, and a reader who wants it has a page for it, since every
// neighbour drawn is a link to its own neighbourhood.
export const NEIGHBOURHOOD_DEPTH = 1;

// #69's two bounds, both on one Entity's page and both about a list a person reads rather
// than about what the graph holds.
//
// 12 Themes: a facet list is only a filter while a reader can take it in at a glance. The
// vocabulary is 2,072 values at ~48 per Article, so a well-reported name carries hundreds
// of them and the head of that distribution is where the subjects it is actually known for
// sit. The count each carries is stated beside it, so a reader can see this is a head and
// not the whole.
export const VIEW_THEME_FACETS = envNumber("GRAPH_VIEW_THEME_FACETS", 12, { min: 1, max: 100 });

// 20 Articles under one edge, newest first, with the edge's whole weight stated above them.
// A weight is a count of Articles and runs to hundreds on a heavy pair; what a reader opens
// a line for is enough reporting to check that the two names really were reported together,
// which is a handful of the most recent — not every window they shared. The two numbers are
// allowed to differ, and the page says so.
export const VIEW_EDGE_CITATIONS = envNumber("GRAPH_VIEW_EDGE_CITATIONS", 20, { min: 1, max: 200 });

// #67's bound, and the smallest one here because it answers the smallest question: enough
// reporting to recognise which name this is, not a page of it. Three Articles per side is
// "which stories is this the name from", which is what a reviewer deciding a fold is
// actually reading for — the counts either side is promoted on are stated beside the
// sample, and they are the pass's, measured over the whole window rather than over three
// rows. Not an env knob for the same reason `NEIGHBOURHOOD_DEPTH` is not: a queue row is
// a glance, and a widened one is a different surface rather than a better one.
export const PROPOSAL_SAMPLE_ARTICLES = 3;

// The two bars #67 turns on, both read by pg_trgm's `similarity()` over normalized
// surface names. v3 §18.5's rule sets them: a wrong merge is more harmful than an
// unresolved duplicate, so the automatic bar sits above every wrong merge measured and
// the band beneath it is where the doubt goes.
//
// Measured on 2026-09-01 against real GKG names, right merges against wrong ones:
//
//   0.923  massachusetts institute of technology / massachusets…   right — one typo
//   0.917  securities and exchange commission / …commision         right — one typo
//   0.867  donald trump / donald j trump                           right — middle initial
//   0.867  john kennedy / john f kennedy                           WRONG — JFK, and a senator
//   0.857  george bush / george w bush                             WRONG — two presidents
//   0.778  australian associated / australian associated press     right — truncation
//   0.778  united states / united states steel                     WRONG — same score
//   0.600  james comey / james coney                               right — one typo
//   0.533  joe biden / joseph biden                                right — missed, see below
//
// 0.90 for the automatic bar: above every wrong merge measured (0.867), and what
// survives it is a single mistyped character in a long name. The middle-initial and
// truncation families straddle the line — `donald j trump` scores exactly what
// `john f kennedy` does, and the two 0.778 rows are a right merge and a wrong one at
// identical scores — so no numeric bar separates them and they all go to a person.
//
// 0.60 for the review floor: `james comey`/`james coney` is the shortest right merge
// still reachable, and beneath it sit `kansas city`/`kansas` (0.583), `niger`/`nigeria`
// (0.556) and `austria`/`australia` (0.500), which are pairs a queue would only waste an
// Admin's attention on.
//
// The honest limit: `joe biden`/`joseph biden` (0.533), `ibm`/`i b m` (0.111) and any
// other initialism are below the floor and are never proposed. Trigrams do not see them
// and no threshold recovers them without the wrong merges above coming too. The upgrade
// path is a hand-written row in `entity_aliases`, which the merge memory already
// supports — ponytail: no route writes one yet, add it when a demo needs `IBM` folded.
export const ENTITY_MERGE_AUTO_SIMILARITY = envFraction("GRAPH_ENTITY_MERGE_AUTO_SIMILARITY", 0.9);

export const ENTITY_MERGE_REVIEW_SIMILARITY = envFraction("GRAPH_ENTITY_MERGE_REVIEW_SIMILARITY", 0.6);

// Checked at load, not per pass: a review floor at or above the automatic bar leaves the
// band empty, so every candidate generated would be merged without anybody seeing it —
// the one misconfiguration of this pair that fails silently in the harmful direction.
if (ENTITY_MERGE_REVIEW_SIMILARITY >= ENTITY_MERGE_AUTO_SIMILARITY) {
  throw new Error(
    `GRAPH_ENTITY_MERGE_REVIEW_SIMILARITY (${ENTITY_MERGE_REVIEW_SIMILARITY}) must be below ` +
      `GRAPH_ENTITY_MERGE_AUTO_SIMILARITY (${ENTITY_MERGE_AUTO_SIMILARITY}), or nothing is ever reviewed.`,
  );
}

// ADR-0028: Themes are never Entities. They are 46,787 of the 66,229 measured
// occurrences over 2,072 controlled-vocabulary values — roughly 48 per Article, so
// theme-to-theme co-occurrence approaches a complete graph and says nothing. A Theme
// is a facet the graph is filtered *by*, which is #69's neighbourhood and the one read
// path that takes one (./loadGraphView.ts).
//
// A list rather than "everything except theme" so the exclusion is a decision the
// compiler checks against GkgAnnotationKind rather than a negation to re-derive. Narrow
// rather than widened to `GkgAnnotationKind[]`, so `PromotableKind` below is the type an
// Entity's kind actually is: promoting a Theme then fails to compile, instead of relying
// on the CHECK constraint to refuse it at runtime.
export const PROMOTABLE_KINDS = ["person", "organization", "location"] as const satisfies readonly GkgAnnotationKind[];

export type PromotableKind = (typeof PROMOTABLE_KINDS)[number];
