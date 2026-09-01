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

// ADR-0028: Themes are never Entities. They are 46,787 of the 66,229 measured
// occurrences over 2,072 controlled-vocabulary values — roughly 48 per Article, so
// theme-to-theme co-occurrence approaches a complete graph and says nothing. A Theme
// is a facet the graph is filtered *by*, which is a later ticket's read path.
//
// A list rather than "everything except theme" so the exclusion is a decision the
// compiler checks against GkgAnnotationKind rather than a negation to re-derive. Narrow
// rather than widened to `GkgAnnotationKind[]`, so `PromotableKind` below is the type an
// Entity's kind actually is: promoting a Theme then fails to compile, instead of relying
// on the CHECK constraint to refuse it at runtime.
export const PROMOTABLE_KINDS = ["person", "organization", "location"] as const satisfies readonly GkgAnnotationKind[];

export type PromotableKind = (typeof PROMOTABLE_KINDS)[number];
