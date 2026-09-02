import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import type { Css, ElementDefinition, StylesheetJson } from "cytoscape";
import { ENTITY_KINDS, ENTITY_KIND_LABELS, getGraphView, type EntityKind, type GraphEdge, type GraphNode, type GraphView } from "../api/client";
import { DashboardRegister, RegisterRow } from "../components/dashboardArchetype";
import { DateStamp, IndexPage } from "../components/indexArchetype";
import { peakOf } from "../components/timelineRegister";
import { EmptyState, EntryList, PendingState, RetryableError } from "../components/uiStates";

// #68: the bounded global graph, and the one reader surface in Tessera that reads a
// different corpus from every other. ADR-0028 — the graph is firehose-derived and
// rolling, not Story-scoped, because zero of 968 GKG Articles came from a seeded feed
// domain and a Story-scoped graph would be permanently empty. So the corpus and the
// window are stated in the reader's own language at the top of the page, in the register
// every other surface states its facts in, rather than footnoted under the picture.
//
// Bounds are not this page's business: the endpoint takes no parameters and answers with
// what it decided to draw (backend/src/graph/loadGraphView.ts). What is this page's
// business is saying how much of the graph that is.

// Kind carried three ways at once (DESIGN.md's Redundant Signal Rule): ink, shape, and
// the word itself in the legend and in every register row — so the graph reads in
// greyscale, and to anyone who cannot tell #1458a6 from #492e84.
//
// The inks are read from the Bureau tokens at draw time so the canvas cannot drift from
// the legend beside it, which takes the same tokens through CSS. The fallbacks are for
// jsdom, which resolves no custom properties.
const KIND_MARK: Record<EntityKind, { shape: Css.NodeShape; token: string; fallback: string }> = {
  person: { shape: "ellipse", token: "--proof-blue", fallback: "#1458a6" },
  organization: { shape: "rectangle", token: "--proof-magenta", fallback: "#c51d62" },
  location: { shape: "diamond", token: "--registered-overlap", fallback: "#492e84" },
};

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// The graph as Cytoscape wants it. Exported and pure so the mapping the picture rests on
// is checkable without a canvas: jsdom cannot render one, so the renderer is stubbed in
// the page's own tests and this is what those tests can still hold to account.
//
// `share` is each quantity against the largest of its kind on the page, so node size
// reads as reporting and edge width as co-mention weight. Both are stated in words in the
// register below — the picture is never the only place a number appears.
export function toGraphElements(view: GraphView): ElementDefinition[] {
  const busiest = peakOf(view.nodes.map((node) => node.articleCount));
  const heaviest = peakOf(view.edges.map((edge) => edge.weight));
  return [
    ...view.nodes.map((node) => ({
      data: {
        id: node.id,
        name: node.canonicalName,
        kind: node.kind,
        share: node.articleCount / busiest,
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

// Bureau on a canvas: square nodes for organizations because corners are square here,
// labels in the page's own face, and the ink spent on identifying a kind and nothing
// else. No hover or selection styling — selecting a node means something in #69 and
// nothing yet, and a picture that responds to a click by doing nothing is worse than one
// that does not respond.
function stylesheet(): StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        label: "data(name)",
        width: "mapData(share, 0, 1, 16, 44)",
        height: "mapData(share, 0, 1, 16, 44)",
        "border-width": 1,
        "border-color": token("--bureau-ink", "#171715"),
        "font-family": "Arial, Helvetica, sans-serif",
        "font-size": 10,
        "font-weight": 700,
        color: token("--bureau-ink", "#171715"),
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-background-color": token("--stock-paper", "#f2f0e9"),
        "text-background-opacity": 0.85,
        "text-background-padding": "2px",
        "min-zoomed-font-size": 7,
      },
    },
    ...ENTITY_KINDS.map((kind) => ({
      selector: `node[kind="${kind}"]`,
      style: { shape: KIND_MARK[kind].shape, "background-color": token(KIND_MARK[kind].token, KIND_MARK[kind].fallback) },
    })),
    {
      selector: "edge",
      style: {
        width: "mapData(share, 0, 1, 1, 5)",
        "line-color": token("--quiet-ink", "#55534e"),
        opacity: 0.55,
        "curve-style": "straight",
      },
    },
  ];
}

// The picture. A reader pans and zooms it; nothing here edits the graph, so nothing is
// grabbable or selectable. `role="img"` with a label that states what it draws, because
// a canvas is unreachable by keyboard and unreadable by a screen reader — the register
// under it is the same graph in words, which is the reading those two get.
function GraphPlot({ view }: { view: GraphView }) {
  const plot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!plot.current) return;
    const cy = cytoscape({
      container: plot.current,
      elements: toGraphElements(view),
      style: stylesheet(),
      // `cose` is Cytoscape's own force layout — no plugin, and ADR-0019 asked for a
      // force-directed reading. Unanimated: DESIGN.md keeps motion for evidence
      // registration, and a graph that settles while being read is a graph being read
      // twice.
      layout: { name: "cose", animate: false, padding: 28, nodeRepulsion: () => 12000, idealEdgeLength: () => 90 },
      autoungrabify: true,
      autounselectify: true,
    });
    return () => cy.destroy();
  }, [view]);

  return (
    <div
      className="graph-plot"
      ref={plot}
      role="img"
      aria-label={`A force-directed graph of ${view.nodes.length} names joined by ${view.edges.length} co-mention links. Every name it draws is listed in words below it.`}
    />
  );
}

// "1 report" / "24 reports", wherever a count of reporting is stated — over the whole
// graph, on one name, or on one link — so the three read as the same unit.
const reports = (count: number) => `${count} report${count === 1 ? "" : "s"}`;

// The corpus statement's measured half, in the ledger register every other surface states
// its facts in: which corpus, which window, how much reporting, and how much of the graph
// is on screen. Beside the prose rather than under the picture, because a reader who
// mistakes this for the curated corpus has misread every name on the page.
function Provenance({ view }: { view: GraphView }) {
  const drawn =
    view.nodes.length === view.entityCount
      ? `All ${view.entityCount} names`
      : `${view.nodes.length} of ${view.entityCount} names`;
  return (
    <dl className="graph-ledger">
      <div>
        <dt>Corpus</dt>
        <dd>GDELT firehose, plus Tessera&rsquo;s curated corpus</dd>
      </div>
      <div>
        <dt>Window</dt>
        <dd>
          Rolling {view.retainedDays} days
          {view.from && view.to && (
            <>
              {" · "}
              <DateStamp iso={view.from} /> – <DateStamp iso={view.to} />
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Reporting</dt>
        <dd>{reports(view.articleCount)} cited</dd>
      </div>
      <div>
        <dt>Drawn</dt>
        <dd>{drawn}</dd>
      </div>
    </dl>
  );
}

// The kinds actually on the page, each with how many names it accounts for: a legend of
// three marks where only two are drawn states a distinction the picture does not make.
function kindsDrawn(view: GraphView): { kind: EntityKind; count: number }[] {
  return ENTITY_KINDS.map((kind) => ({
    kind,
    count: view.nodes.filter((node) => node.kind === kind).length,
  })).filter(({ count }) => count > 0);
}

// How many of the drawn links each drawn name is on, and the heaviest of them. Degree a
// reader can count off the picture; a link's *weight* is drawn as line width and nowhere
// else, and a line cannot be measured by a screen reader, so the strongest one is stated
// in words beside the name it belongs to. Both are read from the edges in view rather than
// from a count the endpoint could send, so both are about the picture on screen.
function linksDrawn(view: GraphView): Map<string, { count: number; strongest: GraphEdge }> {
  const links = new Map<string, { count: number; strongest: GraphEdge }>();
  for (const edge of view.edges) {
    for (const end of [edge.entityAId, edge.entityBId]) {
      const held = links.get(end);
      links.set(end, {
        count: (held?.count ?? 0) + 1,
        strongest: held && held.strongest.weight >= edge.weight ? held.strongest : edge,
      });
    }
  }
  return links;
}

// One name's ledger: its kind in the word the legend uses, and the two quantities the
// picture encodes — reporting as node size, a link's weight as line width — written out.
// A name whose every tie was to a name outside the bound carries no link row rather than a
// zero pointing at nothing.
function metaFor(
  node: GraphNode,
  links: Map<string, { count: number; strongest: GraphEdge }>,
  names: Map<string, string>,
) {
  const link = links.get(node.id);
  const other =
    link && (link.strongest.entityAId === node.id ? link.strongest.entityBId : link.strongest.entityAId);
  return [
    { term: "Kind", value: ENTITY_KIND_LABELS[node.kind] },
    { term: "Reporting", value: reports(node.articleCount) },
    { term: "Links drawn", value: link?.count ?? 0 },
    ...(link && other ? [{ term: "Strongest link", value: `${names.get(other)} · ${reports(link.strongest.weight)}` }] : []),
  ];
}

export default function Graph() {
  const query = useQuery({ queryKey: ["graph"], queryFn: getGraphView });
  const view = query.data;
  const busiest = peakOf(view?.nodes.map((node) => node.articleCount) ?? []);
  const links = view ? linksDrawn(view) : new Map<string, { count: number; strongest: GraphEdge }>();
  const names = new Map(view?.nodes.map((node) => [node.id, node.canonicalName]) ?? []);

  return (
    <IndexPage title="Knowledge graph">
      {query.isPending && <PendingState>Reading the graph…</PendingState>}
      {query.isError && (
        <RetryableError
          message={`Could not load the knowledge graph: ${(query.error as Error).message}`}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      )}
      {/* Nothing resolved yet is not a failure and does not read like one: the request
          answered, the graph is simply empty, and what would fill it is the rule stated. */}
      {view && view.nodes.length === 0 && (
        <EmptyState>
          <p>
            No name has been resolved into the graph yet. A name enters once {view.promotionFloor} separate
            reports have named it, so this fills in as the last {view.retainedDays} days of the GDELT
            firehose are ingested and resolved.
          </p>
        </EmptyState>
      )}
      {view && view.nodes.length > 0 && (
        <>
          <p className="record-prose">
            Drawn from the <strong>retained firehose</strong> — every report GDELT&rsquo;s Global Knowledge
            Graph has named an entity in over the last {view.retainedDays} days, together with
            Tessera&rsquo;s curated corpus. That is a wider and rougher body of reporting than the Stories
            and Briefs elsewhere in Tessera, so a name here will not always open onto a Story you can
            read. A name enters once {view.promotionFloor} separate reports have named it; a link means two
            names were reported together, and its weight is how many reports that was.
            {view.nodes.length < view.entityCount &&
              ` Showing the ${view.nodes.length} most reported names and each one's strongest links, because a
                graph of every name at once is a picture of none of them.`}
          </p>
          <Provenance view={view} />
          {/* Ink, shape and word for each kind, stated once for the whole picture. */}
          <ul className="graph-key" aria-label="What each shape in the graph is">
            {kindsDrawn(view).map(({ kind, count }) => (
              <li key={kind}>
                <span className={`graph-key-mark graph-key-mark--${kind}`} aria-hidden="true" />
                {ENTITY_KIND_LABELS[kind]} · {count}
              </li>
            ))}
          </ul>
          <GraphPlot view={view} />
          {/* The same graph in words: every name the picture draws, in the order the view
              ranked them, with the two measurements the picture encodes as size and width.
              This is the reading a keyboard or a screen reader gets, and the reading anyone
              gets who needs a name rather than a shape. */}
          <DashboardRegister
            heading="Names in the graph"
            folio={`${view.nodes.length} drawn · most reported first`}
          >
            <EntryList>
              {view.nodes.map((node) => (
                <RegisterRow
                  key={node.id}
                  name={node.canonicalName}
                  measure={node.articleCount / busiest}
                  meta={metaFor(node, links, names)}
                />
              ))}
            </EntryList>
          </DashboardRegister>
        </>
      )}
    </IndexPage>
  );
}
