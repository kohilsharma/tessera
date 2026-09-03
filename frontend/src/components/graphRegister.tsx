import { useEffect, useRef, type ReactNode } from "react";
import cytoscape from "cytoscape";
import type { Css, ElementDefinition, StylesheetJson } from "cytoscape";
import { ENTITY_KINDS, ENTITY_KIND_LABELS, type EntityKind, type GraphEdge, type GraphNode } from "../api/client";
import { peakOf } from "./scale";

// The graph drawn the same way wherever it is drawn — the bounded global view (#68) and one
// Entity's neighbourhood (#69). Shared for the reason the two share a read path server-side:
// a name that is an ellipse on one page and a square on the other would be two claims about
// one graph. What differs between the pages is the words around the picture, which is each
// page's own business, and which name is at the centre, which is a parameter here.

// Kind carried three ways at once (DESIGN.md's Redundant Signal Rule): ink, shape, and the
// word itself in the legend and in every register row — so the graph reads in greyscale, and
// to anyone who cannot tell #1458a6 from #492e84.
//
// The inks are read from the Bureau tokens at draw time so the canvas cannot drift from the
// legend beside it, which takes the same tokens through CSS. No hex here: DESIGN.md keeps the
// palette at `:root` and has pages consume it, and a fallback copy would be a second palette
// to keep in step — jsdom resolves no custom properties, but jsdom also renders no canvas, so
// nothing there ever observes the value.
const KIND_MARK: Record<EntityKind, { shape: Css.NodeShape; token: string }> = {
  person: { shape: "ellipse", token: "--proof-blue" },
  organization: { shape: "rectangle", token: "--proof-magenta" },
  location: { shape: "diamond", token: "--registered-overlap" },
};

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Both payloads structurally: a picture is nodes and edges, and neither page's extra facts
// are the layout's business.
export type GraphPicture = { nodes: GraphNode[]; edges: GraphEdge[] };

// "1 report" / "24 reports", wherever a count of reporting is stated — over a whole graph, on
// one name, or on one link — so every one of them reads as the same unit.
export const reports = (count: number) => `${count} report${count === 1 ? "" : "s"}`;

// The corpus every graph surface reads, and the rule that bounds half of it, in one wording
// for both. AGENTS.md's membership invariant exempts this seam on the condition that it states
// its corpus on screen — so the statement is shared with the picture rather than written per
// page, and a surface that draws the graph cannot forget to make it.
//
// Two rows, not one value: CONTEXT.md's *Retention Window* expires only `metadata_only` GDELT
// rows, so the Curated Corpus, anything enriched with text, and any Article a Story or Brief
// holds all outlive it. "Rolling 7 days" is true of the firehose and false of the graph, which
// is why the measured span each page holds rides separately.
export function corpusLedger(retainedDays: number): { term: string; value: ReactNode }[] {
  return [
    { term: "Corpus", value: "GDELT firehose, plus Tessera’s Curated Corpus" },
    { term: "Retention window", value: `Rolling ${retainedDays} days of firehose metadata` },
  ];
}

// The ledger drawn, for the surfaces that draw one as a list rather than as a Record
// masthead's. `rows` is each page's own — a global view states its span and how much of
// the graph is on screen, a review queue states neither — and the corpus rows come first,
// because which corpus was read is the fact the others are true *of*.
export function GraphLedger({ retainedDays, rows = [] }: { retainedDays: number; rows?: { term: string; value: ReactNode }[] }) {
  return (
    <dl className="graph-ledger">
      {[...corpusLedger(retainedDays), ...rows].map(({ term, value }) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// What a name is and what a link means, in one wording for every surface that draws them.
// Written once for the reason the picture is: the promotion floor and the weight are the
// two things a reader has to be told before any of it is readable, and two pages phrasing
// them differently would be two claims about one graph.
export const graphRule = (promotionFloor: number) =>
  `A name enters the graph once ${promotionFloor} separate reports have named it; a link means two names ` +
  `were reported together, and its weight is how many reports that was.`;

// Why the page is showing part of the graph rather than all of it, in the words the other
// surface uses. Both halves are the caller's: what it kept ("the 60 most reported names")
// and what it bounded ("graph", "neighbourhood"), since a global view and one name's
// surroundings are cut down to different things. The reason they are cut down is the same
// sentence on both, which is the half worth having once.
export const boundNote = (kept: string, subject: string) =>
  ` Showing ${kept}, because a ${subject} of every name at once is a picture of none of them.`;

// "All 34 names" / "20 of 34 names" / "No names" — how much of a working set is drawn,
// stated the same way wherever a picture is bounded. Read from the drawn nodes against the
// count the endpoint measured, so it never implies the graph is as wide as the screen.
export function drawnOf(shown: number, whole: number): string {
  if (whole === 0) return "No names";
  return shown === whole ? `All ${whole} names` : `${shown} of ${whole} names`;
}

// The other end of a line from one name. Stored order is storage's business — a pair is one
// row ordered by id — so no reader surface should be re-deriving which end it arrived from.
export function otherEnd(edge: GraphEdge, entityId: string): string {
  return edge.entityAId === entityId ? edge.entityBId : edge.entityAId;
}

// Every drawn line each drawn name is on. What both surfaces read an edge list for: degree,
// the strongest tie, the weight of one pair, the interlinks a neighbour carries. Read from the
// edges in view rather than from a count the endpoint could send, so what it measures is the
// picture on screen — and walked once here rather than in a loop per page, because handling
// both ends of every row is the part that is easy to get wrong twice.
export function edgesOn(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const on = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    for (const end of [edge.entityAId, edge.entityBId]) {
      const held = on.get(end);
      if (held) held.push(edge);
      else on.set(end, [edge]);
    }
  }
  return on;
}

// The heaviest of the lines one name is on, first-wins on a tie so the payload's own order
// (weight descending) decides. `undefined` where the name is on none, which is a name the
// picture draws as an isolate and a register row states as `Links drawn 0`.
export function strongestOf(edges: GraphEdge[]): GraphEdge | undefined {
  return edges.reduce<GraphEdge | undefined>((best, edge) => (best && best.weight >= edge.weight ? best : edge), undefined);
}

// The graph as Cytoscape wants it. Exported and pure so the mapping the picture rests on is
// checkable without a canvas: jsdom cannot render one, so the renderer is stubbed in the
// tests and this is what those tests can still hold to account.
//
// `share` is each quantity against the largest of its kind on the page, so node size reads as
// reporting and edge width as co-mention weight. Both are stated in words in the register
// below — the picture is never the only place a number appears.
//
// `focusId` marks the one name a neighbourhood is drawn around, and is absent on the global
// view, where no name is the subject. Set only on the matched node, so what the global view
// hands the layout is unchanged by #69 existing.
export function toGraphElements(view: GraphPicture, focusId?: string): ElementDefinition[] {
  const busiest = peakOf(view.nodes.map((node) => node.articleCount));
  const heaviest = peakOf(view.edges.map((edge) => edge.weight));
  return [
    ...view.nodes.map((node) => ({
      data: {
        id: node.id,
        name: node.canonicalName,
        kind: node.kind,
        share: node.articleCount / busiest,
        ...(node.id === focusId ? { focus: true } : {}),
      },
    })),
    ...view.edges.map((edge) => ({
      data: {
        id: `${edge.entityAId}~${edge.entityBId}`,
        source: edge.entityAId,
        target: edge.entityBId,
        share: edge.weight / heaviest,
      },
    })),
  ];
}

// Bureau on a canvas: square nodes for organizations because corners are square here, labels
// in the page's own face, and the ink spent on identifying a kind and nothing else.
//
// The focus is marked by border weight and type size rather than by ink, so it survives
// greyscale — and it is never the only statement of which name this is: the page's masthead
// carries that name in words.
function stylesheet(): StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        label: "data(name)",
        width: "mapData(share, 0, 1, 16, 44)",
        height: "mapData(share, 0, 1, 16, 44)",
        "border-width": 1,
        "border-color": token("--bureau-ink"),
        "font-family": token("--font-ui"),
        "font-size": 10,
        "font-weight": 700,
        color: token("--bureau-ink"),
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-background-color": token("--stock-paper"),
        "text-background-opacity": 0.85,
        "text-background-padding": "2px",
        "min-zoomed-font-size": 7,
      },
    },
    ...ENTITY_KINDS.map((kind) => ({
      selector: `node[kind="${kind}"]`,
      style: { shape: KIND_MARK[kind].shape, "background-color": token(KIND_MARK[kind].token) },
    })),
    {
      selector: "node[focus]",
      style: { "border-width": 3, "font-size": 12, "text-background-opacity": 1 },
    },
    {
      selector: "edge",
      style: {
        width: "mapData(share, 0, 1, 1, 5)",
        "line-color": token("--quiet-ink"),
        opacity: 0.55,
        "curve-style": "straight",
      },
    },
  ];
}

// The picture. A reader pans and zooms it, tapping a name opens that name's neighbourhood
// (#69) — the same destination the register row beneath it links to, because a canvas is
// unreachable by keyboard and unreadable by a screen reader — and, where the page has
// somewhere to put it, tapping a line opens the reporting that line was drawn from.
// `role="img"` with a label that states what it draws, and the register under it is the same
// graph in words, which is the reading those two get.
//
// Nothing here edits the graph, so nothing is grabbable or selectable: `onOpen` navigates, it
// does not select, and a selected node would draw a state the page does not otherwise have.
export function GraphPlot({
  view,
  focusId,
  label,
  onOpen,
  onOpenEdge,
}: {
  view: GraphPicture;
  focusId?: string;
  label: string;
  onOpen: (entityId: string) => void;
  // The two names a tapped line joins, in stored order. Absent on the global view, which has
  // no drawer to open one into; a page that takes it decides which of its lines it can answer
  // for. Reading it back off the element's own data keeps the handler out of the layout's way.
  onOpenEdge?: (entityAId: string, entityBId: string) => void;
}) {
  const plot = useRef<HTMLDivElement>(null);
  // The latest handlers, read at tap time: in the dependency list they would tear down and
  // re-run the force layout on every render that redefines a callback, and a graph that
  // re-settles while it is being read is a graph being read twice.
  const open = useRef(onOpen);
  open.current = onOpen;
  const openEdge = useRef(onOpenEdge);
  openEdge.current = onOpenEdge;

  useEffect(() => {
    if (!plot.current) return;
    const cy = cytoscape({
      container: plot.current,
      elements: toGraphElements(view, focusId),
      style: stylesheet(),
      // `cose` is Cytoscape's own force layout — no plugin, and ADR-0019 asked for a
      // force-directed reading. Unanimated: DESIGN.md keeps motion for evidence
      // registration.
      layout: { name: "cose", animate: false, padding: 28, nodeRepulsion: () => 12000, idealEdgeLength: () => 90 },
      autoungrabify: true,
      autounselectify: true,
    });
    cy.on("tap", "node", (event) => open.current(event.target.id()));
    cy.on("tap", "edge", (event) => {
      const { source, target } = event.target.data() as { source: string; target: string };
      openEdge.current?.(source, target);
    });
    return () => cy.destroy();
  }, [view, focusId]);

  return <div className="graph-plot" ref={plot} role="img" aria-label={label} />;
}

// Ink, shape and word for each kind, stated once for the whole picture — and only for the
// kinds actually on it: a legend of three marks where two are drawn states a distinction the
// picture does not make.
export function GraphKey({ nodes }: { nodes: GraphNode[] }) {
  const drawn = ENTITY_KINDS.map((kind) => ({
    kind,
    count: nodes.filter((node) => node.kind === kind).length,
  })).filter(({ count }) => count > 0);

  return (
    <ul className="graph-key" aria-label="What each shape in the graph is">
      {drawn.map(({ kind, count }) => (
        <li key={kind}>
          <span className={`graph-key-mark graph-key-mark--${kind}`} aria-hidden="true" />
          {ENTITY_KIND_LABELS[kind]} · {count}
        </li>
      ))}
    </ul>
  );
}
