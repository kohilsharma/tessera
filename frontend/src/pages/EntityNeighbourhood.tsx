import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ENTITY_KIND_LABELS,
  getEdgeCitations,
  getEntityNeighbourhood,
  type GraphEdge,
  type GraphNode,
} from "../api/client";
import { DashboardRegister, RegisterRow } from "../components/dashboardArchetype";
import { GraphKey, GraphPlot, reports } from "../components/graphRegister";
import { DateStamp, Entry, FilterRegister } from "../components/indexArchetype";
import { ThemeFacetFilter } from "../components/listControls";
import { RecordMasthead, RecordSection } from "../components/recordArchetype";
import { peakOf } from "../components/timelineRegister";
import { EmptyState, EntryList, PendingState, RetryableError } from "../components/uiStates";

// #69: one Entity's record — the names reported alongside it, and the reporting behind every
// one of those connections. A Record page rather than an Index, because this is one thing with
// facts about it, and the picture is one of those facts rather than the page's subject.
//
// The bounds are the global view's, applied by the same read path server-side
// (backend/src/graph/loadGraphView.ts), so the two pictures cannot disagree about what is in
// the graph. What this page owes a reader on top of #68's statement of corpus and window is
// depth: a hop count is invisible in a layout, so it is stated in the ledger.

// The weight of each drawn edge that touches the focus — what "reported together" means for
// one neighbour — and, for the rest, how many of the drawn links each name is on. Both read
// from the edges in view rather than from a count the endpoint could send, so both are about
// the picture on screen.
//
// Interlink weights are not stated here, only counted: a line between two neighbours is
// theirs, and it is stated as reporting on whichever of them the reader opens next. The
// numbers this page states in words are the ones its own picture encodes.
function tiesTo(focusId: string, edges: GraphEdge[]) {
  const ties = new Map<string, number>();
  const others = new Map<string, number>();
  for (const edge of edges) {
    const [a, b] = [edge.entityAId, edge.entityBId];
    if (a === focusId || b === focusId) ties.set(a === focusId ? b : a, edge.weight);
    else for (const end of [a, b]) others.set(end, (others.get(end) ?? 0) + 1);
  }
  return { ties, others };
}

// The reporting one link was observed in, opened under the name it belongs to. Its own request
// and its own four states: a reader who opens a link is owed either the evidence or the reason
// there is none, and neither is the neighbourhood's business.
//
// Metadata only, and it says so. The endpoint serves what a Publisher's Terms Class allows a
// list to carry (ADR-0018); article text lives on the Article record, where the mode that
// governs it is stated beside it.
function EdgeEvidence({
  focus,
  neighbour,
  theme,
}: {
  focus: GraphNode;
  neighbour: GraphNode;
  theme: string;
}) {
  const query = useQuery({
    queryKey: ["graph", "edge", focus.id, neighbour.id, theme],
    queryFn: () => getEdgeCitations(focus.id, neighbour.id, theme || null),
  });

  if (query.isPending) return <PendingState>Reading the reporting behind this link…</PendingState>;
  if (query.isError)
    return (
      <RetryableError
        message={`Could not load the reporting behind this link: ${(query.error as Error).message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  const { weight, citations } = query.data;
  return (
    <div className="graph-evidence">
      <p className="graph-evidence-note">
        {citations.length === weight
          ? `All ${reports(weight)} that named ${focus.canonicalName} and ${neighbour.canonicalName} together.`
          : `The ${citations.length} most recent of ${reports(weight)} that named ${focus.canonicalName} and ${neighbour.canonicalName} together.`}{" "}
        Each opens its Article record, where the article text Tessera may show is stated with it.
      </p>
      <EntryList>
        {citations.map((citation) => (
          <Entry
            key={citation.id}
            to={`/articles/${citation.id}`}
            title={citation.title}
            meta={[
              { term: "Publisher", value: citation.publisher.name },
              { term: "Published", value: <DateStamp iso={citation.publishedAt} /> },
              {
                term: "Story",
                // This graph reads the retained firehose (ADR-0028), so most of its reporting
                // sits in no Story at all. Stated either way: an absent link here is a fact
                // about the corpus, and a missing row would read as an oversight.
                value: citation.story ? (
                  <Link to={`/stories/${citation.story.id}`}>{citation.story.title}</Link>
                ) : (
                  "Not in a Story"
                ),
              },
            ]}
          />
        ))}
      </EntryList>
    </div>
  );
}

export default function EntityNeighbourhood() {
  const { entityId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = searchParams.get("theme") ?? "";
  const navigate = useNavigate();
  // Which link's evidence is open, by the neighbour on its other end. One at a time: the
  // drawer is the answer to "was this pair really reported together", which is a question
  // about one pair.
  const [openLink, setOpenLink] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["graph", "entity", entityId, theme],
    queryFn: () => getEntityNeighbourhood(entityId!, theme || null),
    enabled: !!entityId,
  });

  // The facet in the address bar, so a narrowed neighbourhood is a link a reader can share —
  // and an open drawer closed with it, because the link it belonged to may not survive the
  // narrowing.
  function selectTheme(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("theme", next);
    else params.delete("theme");
    setOpenLink(null);
    setSearchParams(params);
  }

  if (query.isPending) return <PendingState>Reading this Entity&rsquo;s neighbourhood…</PendingState>;
  // A name the graph does not hold arrives as the 404's own message in the shared error
  // treatment, as a missing Story and a missing Article do: a merge folded it away or a pass
  // demoted it, and both reach a reader as a link that no longer resolves.
  if (query.isError)
    return (
      <RetryableError
        message={`Could not load this Entity: ${(query.error as Error).message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  const view = query.data;
  const { focus, themes, neighbourCount } = view;
  const neighbours = view.nodes.filter((node) => node.id !== focus.id);
  const { ties, others } = tiesTo(focus.id, view.edges);
  const heaviest = peakOf(neighbours.map((node) => ties.get(node.id) ?? 0));
  const drawn =
    neighbourCount === 0
      ? "No names"
      : neighbours.length === neighbourCount
        ? `All ${neighbourCount} names`
        : `${neighbours.length} of ${neighbourCount} names`;
  // The facet travels with the reader walking from name to name: a narrowed reading of the
  // graph stays narrowed until they widen it.
  const walkTo = (id: string) => `/graph/entities/${id}${theme ? `?theme=${encodeURIComponent(theme)}` : ""}`;

  return (
    <main>
      <RecordMasthead
        folio="Entity"
        back={{ to: "/graph", label: "Back to the knowledge graph" }}
        title={focus.canonicalName}
        dek={theme ? `Narrowed to reporting filed under ${theme}.` : undefined}
        ledger={[
          { term: "Kind", value: ENTITY_KIND_LABELS[focus.kind] },
          {
            term: "Also known as",
            // Aliases are remembered normalized (backend/src/entities/EntityAlias.ts), which is
            // how a merge is keyed and re-applied every pass — so they are shown as what they
            // are rather than dressed up as reported spellings.
            value:
              focus.aliases.length > 0
                ? focus.aliases.join(", ")
                : "No other spelling has been merged into this name",
          },
          {
            term: "Reporting",
            value:
              focus.articleCount === 0 ? (
                "None inside the retained window"
              ) : (
                <>
                  {reports(focus.articleCount)} cited
                  {focus.from && focus.to && (
                    <>
                      {" · "}
                      <DateStamp iso={focus.from} /> – <DateStamp iso={focus.to} />
                    </>
                  )}
                </>
              ),
          },
          // Bounded and stated, because a hop count is not something a reader can see in a
          // layout: everything drawn was reported alongside this name itself, never alongside
          // one of its neighbours.
          { term: "Depth", value: `${view.depth} hop from this name` },
          { term: "Retention window", value: `Rolling ${view.retainedDays} days of firehose metadata` },
          { term: "Drawn", value: drawn },
        ]}
      />

      <RecordSection heading="Neighbourhood">
        {/* Themes narrow the reading and are never drawn (ADR-0028). The vocabulary is this
            name's own head of it, counted over its whole reporting rather than the filtered
            slice, so switching facets is never a dead end — and it stays on screen when the
            facet has emptied the neighbourhood, because clearing it is the way back. */}
        {(themes.length > 0 || theme) && (
          <FilterRegister label="Narrow this neighbourhood by Theme">
            <ThemeFacetFilter value={theme} facets={themes} onChange={selectTheme} />
          </FilterRegister>
        )}

        {neighbourCount === 0 ? (
          <EmptyState>
            {theme ? (
              <p>
                No reporting filed under {theme} names <strong>{focus.canonicalName}</strong> alongside
                another name. Clear the Theme to read this name&rsquo;s whole neighbourhood.
              </p>
            ) : (
              // The acceptance criterion's own empty state: the name is still in the graph, and
              // the reporting its links rested on is not. The promotion floor is not mentioned
              // here — nor in prose above, which is why that paragraph is drawn with the
              // picture — because it would point the reader at a rule this name has cleared.
              <p>
                Nothing inside the retained window still names <strong>{focus.canonicalName}</strong>{" "}
                alongside another name. The reporting its links rested on has rolled out of the last{" "}
                {view.retainedDays} days of firehose metadata, so there is no link left to draw.
              </p>
            )}
          </EmptyState>
        ) : (
          <>
            <p className="record-prose">
              Names reported alongside <strong>{focus.canonicalName}</strong> in the{" "}
              <strong>retained firehose</strong> — GDELT&rsquo;s Global Knowledge Graph over the last{" "}
              {view.retainedDays} days, together with Tessera&rsquo;s Curated Corpus. A name enters the
              graph once {view.promotionFloor} separate reports have named it; a link means two names
              were reported together, and its weight is how many reports that was. Open a link to read
              those reports.
              {neighbours.length < neighbourCount &&
                ` Showing the ${neighbours.length} names most reported alongside this one, because a
                  neighbourhood of every name at once is a picture of none of them.`}
            </p>
            <GraphKey nodes={view.nodes} />
            <GraphPlot
              view={view}
              focusId={focus.id}
              label={`A force-directed graph of ${focus.canonicalName} and the ${neighbours.length} names reported alongside it, joined by ${view.edges.length} co-mention links. Every name it draws is listed in words below it, and opens that name's own neighbourhood.`}
              onOpen={(id) => {
                if (id !== focus.id) navigate(walkTo(id));
              }}
              // A tapped line answers "on what basis?" the way the register's own command does,
              // so the picture is not the one place on this page a number cannot be checked. A
              // line into the focus is one of its ties and opens that neighbour's reporting; a
              // line between two neighbours is theirs rather than this page's, and opens nothing
              // here — it is stated as reporting on whichever of them the reader walks to next.
              onOpenEdge={(a, b) => {
                if (a === focus.id || b === focus.id) setOpenLink(a === focus.id ? b : a);
              }}
            />
          </>
        )}
      </RecordSection>

      {neighbourCount > 0 && (
        // The same neighbourhood in words: the reading a keyboard and a screen reader get, and
        // the only place a link's evidence can be opened — a canvas has nowhere to put it. The
        // register carries its own heading and folio, so it needs no record section around it.
        <DashboardRegister
          heading="Reported alongside"
          folio={`${neighbours.length} drawn · most reported together first`}
        >
          <EntryList>
            {neighbours.map((node) => {
              const weight = ties.get(node.id) ?? 0;
              const open = openLink === node.id;
              // Deterministic rather than `useId`, which cannot be called per row: the button
              // sits in the register's third column, so the evidence it opens is beside it
              // rather than after it, and `aria-controls` is what says which is which.
              const panelId = `edge-evidence-${node.id}`;
              return (
                <RegisterRow
                  key={node.id}
                  name={node.canonicalName}
                  to={walkTo(node.id)}
                  measure={weight / heaviest}
                  meta={[
                    { term: "Kind", value: ENTITY_KIND_LABELS[node.kind] },
                    { term: "Reported together", value: reports(weight) },
                    { term: "Reporting", value: reports(node.articleCount) },
                    { term: "Other links drawn", value: others.get(node.id) ?? 0 },
                  ]}
                  body={
                    // Always present, empty until opened: `aria-controls` below has to name an
                    // element that exists, and a reference into nothing is a reference a screen
                    // reader cannot follow.
                    <div id={panelId}>
                      {open && <EdgeEvidence focus={focus} neighbour={node} theme={theme} />}
                    </div>
                  }
                  action={
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setOpenLink(open ? null : node.id)}
                    >
                      {open ? "Hide reporting" : "Show reporting"}
                    </button>
                  }
                />
              );
            })}
          </EntryList>
        </DashboardRegister>
      )}
    </main>
  );
}
