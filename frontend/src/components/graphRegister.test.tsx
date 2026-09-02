import { describe, expect, it } from "vitest";
import { toGraphElements } from "./graphRegister";
import type { GraphView } from "../api/client";

// The one part of the picture that is checkable without a canvas, and the part a wrong answer
// would silently mis-draw: what Cytoscape is handed. Shared by the global view (#68) and one
// Entity's neighbourhood (#69), so it is tested where it lives rather than on either page.
const view: GraphView = {
  retainedDays: 7,
  promotionFloor: 5,
  entityCount: 5,
  articleCount: 24,
  from: "2026-08-26T06:00:00Z",
  to: "2026-09-01T18:00:00Z",
  nodes: [
    { id: "e1", canonicalName: "Reserve Bank", kind: "organization", articleCount: 18 },
    { id: "e2", canonicalName: "Ada Lovelace", kind: "person", articleCount: 11 },
    { id: "e3", canonicalName: "Canberra", kind: "location", articleCount: 6 },
  ],
  edges: [
    { entityAId: "e1", entityBId: "e2", weight: 9 },
    { entityAId: "e1", entityBId: "e3", weight: 4 },
  ],
};

describe("the elements handed to the layout", () => {
  it("gives every node and edge its share of the largest quantity on the page", () => {
    expect(toGraphElements(view)).toEqual([
      { data: { id: "e1", name: "Reserve Bank", kind: "organization", share: 1 } },
      { data: { id: "e2", name: "Ada Lovelace", kind: "person", share: 11 / 18 } },
      { data: { id: "e3", name: "Canberra", kind: "location", share: 6 / 18 } },
      { data: { id: "e1~e2", source: "e1", target: "e2", share: 1 } },
      { data: { id: "e1~e3", source: "e1", target: "e3", share: 4 / 9 } },
    ]);
  });

  it("hands an empty graph nothing to lay out rather than dividing by an absent peak", () => {
    expect(toGraphElements({ nodes: [], edges: [] })).toEqual([]);
  });

  // The neighbourhood's one difference from the global view, and the reason it is a parameter
  // rather than a second mapping: exactly one node is the subject, and on the global view none
  // is — so the flag must be absent there, not false.
  it("marks the one name a neighbourhood is drawn around, and no other", () => {
    const marked = toGraphElements(view, "e2");

    expect(marked[1]).toEqual({ data: { id: "e2", name: "Ada Lovelace", kind: "person", share: 11 / 18, focus: true } });
    expect(marked.filter((element) => "focus" in element.data!)).toHaveLength(1);
  });

  it("marks nothing when the focus is not among the drawn names", () => {
    expect(toGraphElements(view, "gone")).toEqual(toGraphElements(view));
  });
});
