import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ENTITY_KIND_LABELS, getGraphView, type GraphEdge, type GraphNode, type GraphView } from "../api/client";
import { DashboardRegister, RegisterRow } from "../components/dashboardArchetype";
import {
  boundNote,
  drawnOf,
  edgesOn,
  graphRule,
  GraphKey,
  GraphLedger,
  GraphPlot,
  otherEnd,
  reports,
  strongestOf,
} from "../components/graphRegister";
import { DateStamp, IndexPage } from "../components/indexArchetype";
import { peakOf } from "../components/scale";
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
//
// The picture, its legend and its Cytoscape mapping are shared with #69's neighbourhood
// (../components/graphRegister) — one graph drawn one way — and a name here opens onto that
// page, from the canvas and from its register row alike.

// The corpus statement's measured half, in the ledger register every other surface states
// its facts in: which corpus, under what retention, how much reporting and over what span,
// and how much of the graph is on screen. Beside the prose rather than under the picture,
// because a reader who mistakes this for the Curated Corpus has misread every name on the
// page.
//
// The retention rule and the graph's span are two rows, not one value: CONTEXT.md's
// *Retention Window* is narrow on purpose — it expires only `metadata_only` GDELT rows, so
// the Curated Corpus, anything enriched with text, and any Article a Story or a Brief holds
// all outlive it. "Rolling 7 days" is therefore true of the firehose and false of the graph,
// and stamping it over a span is a claim this page cannot support. The measured span rides
// with the measured count instead, where both are facts about what is actually cited.
function Provenance({ view }: { view: GraphView }) {
  return (
    <GraphLedger
      retainedDays={view.retainedDays}
      rows={[
        {
          term: "Reporting",
          value: (
            <>
              {reports(view.articleCount)} cited
              {view.from && view.to && (
                <>
                  {" · "}
                  <DateStamp iso={view.from} /> – <DateStamp iso={view.to} />
                </>
              )}
            </>
          ),
        },
        { term: "Drawn", value: drawnOf(view.nodes.length, view.entityCount) },
      ]}
    />
  );
}

// One name's ledger: its kind in the word the legend uses, and the two quantities the
// picture encodes — reporting as node size, a link's weight as line width — written out.
// A name whose every tie was to a name outside the bound states `Links drawn 0` and no
// strongest link: the zero is why the row beneath it is missing, so stating it is what
// keeps the omission from reading as an oversight.
//
// The strongest link is named only when the name on its other end is one of the drawn ones.
// It always is — the endpoint bounds edges to the nodes it returned — so this is a guard
// against a future selection that stops being true, not against today's, and it costs one
// `&&` rather than rendering the word "undefined" at a reader.
function metaFor(node: GraphNode, links: Map<string, GraphEdge[]>, names: Map<string, string>) {
  const on = links.get(node.id) ?? [];
  const strongest = strongestOf(on);
  const otherName = strongest && names.get(otherEnd(strongest, node.id));
  return [
    { term: "Kind", value: ENTITY_KIND_LABELS[node.kind] },
    { term: "Reporting", value: reports(node.articleCount) },
    { term: "Links drawn", value: on.length },
    ...(strongest && otherName
      ? [{ term: "Strongest link", value: `${otherName} · ${reports(strongest.weight)}` }]
      : []),
  ];
}

export default function Graph() {
  const query = useQuery({ queryKey: ["graph"], queryFn: getGraphView });
  const navigate = useNavigate();
  const view = query.data;
  const busiest = peakOf(view?.nodes.map((node) => node.articleCount) ?? []);
  // Degree a reader can count off the picture, and the heaviest line each name is on: a
  // link's weight is drawn as line width and nowhere else, and a line cannot be measured by
  // a screen reader, so the strongest one is stated in words beside the name it belongs to.
  const links = edgesOn(view?.edges ?? []);
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
      {/* Nothing to draw is not a failure and does not read like one: the request answered,
          and what would fill the picture is stated as the rule that governs it. But there
          are two different empty graphs here and a reader is owed the one in front of them.
          Nothing promoted is a floor not yet reached. Names promoted with no pair among them
          is a graph of nodes and no edges — the view draws no isolate, because a dot joined
          to nothing asserts nothing — and telling that reader about the promotion floor
          would point them at a rule their graph has already cleared. */}
      {view && view.nodes.length === 0 && (
        <EmptyState>
          {view.entityCount === 0 ? (
            <p>
              No name has been resolved into the graph yet. A name enters once {view.promotionFloor} separate reports have named it;
              common GKG demonyms are omitted from the picture. This fills in as the last {view.retainedDays} days of the GDELT
              firehose are ingested and resolved.
            </p>
          ) : (
            <p>
              {view.entityCount === 1 ? "One name has" : `${view.entityCount} names have`} been resolved, but
              no two names have yet been reported together, so there is no link to draw and nothing to place. Common GKG demonyms
              are omitted from the picture.
              A name joins the picture once one report names it alongside another.
            </p>
          )}
        </EmptyState>
      )}
      {view && view.nodes.length > 0 && (
        <>
          <p className="record-prose">
            Drawn from the <strong>retained firehose</strong> — every report GDELT&rsquo;s Global Knowledge
            Graph has named an entity in over the last {view.retainedDays} days, together with
            Tessera&rsquo;s Curated Corpus. That is a wider and rougher body of reporting than the Stories
            and Briefs elsewhere in Tessera, so a name here will not always open onto a Story you can
            read. {graphRule(view.promotionFloor)} Open any name for its own neighbourhood, where every
            link shows the reporting it was observed in.
            {view.nodes.length < view.entityCount &&
              boundNote(`the ${view.nodes.length} most reported names and each one's strongest links`, "graph")}
          </p>
          <Provenance view={view} />
          <GraphKey nodes={view.nodes} />
          <GraphPlot
            view={view}
            label={`A force-directed graph of ${view.nodes.length} names joined by ${view.edges.length} co-mention links. Every name it draws is listed in words below it, and opens that name's own neighbourhood.`}
            onOpen={(entityId) => navigate(`/graph/entities/${entityId}`)}
            onOpenEdge={(entityAId, entityBId) => navigate(`/graph/entities/${entityAId}?link=${entityBId}`)}
          />
          {/* The same graph in words: every name the picture draws, in the order the view
              ranked them, with the two measurements the picture encodes as size and width.
              This is the reading a keyboard or a screen reader gets, and the reading anyone
              gets who needs a name rather than a shape — so it is also where clicking a
              node is reachable without a canvas, each name opening its neighbourhood (#69). */}
          <DashboardRegister
            heading="Names in the graph"
            folio={`${view.nodes.length} drawn · most reported first`}
          >
            <EntryList total={view.entityCount}>
              {view.nodes.map((node) => (
                <RegisterRow
                  key={node.id}
                  name={node.canonicalName}
                  to={`/graph/entities/${node.id}`}
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
