import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Link } from "react-router-dom";
import { searchTimeline, type SearchTimelineLane, type TimelinePoint } from "../api/client";
import { ArticleEntry, FilterRegister, IndexPage } from "../components/indexArchetype";
import { CategoryFilter, DateRangeFilter, SearchTermFilter, useListQueryParams } from "../components/listControls";
import { PERIOD_LABELS, TimelineAxis, TimelineVolume } from "../components/timelineRegister";
import { EmptyState, EntryList, PendingState, RetryableError } from "../components/uiStates";

// #65: search anything, read it as a timeline. The fourth Index-archetype surface — same
// filter register, same entry rows — but what it registers is one lane per Story rather
// than a ranked list, so several developing events read as parallel instead of as one flat
// sequence. Nothing here re-implements relevance or re-projects Articles onto an axis: the
// endpoint reuses the search ranking and the timeline seam (backend/src/routes/search.ts).
//
// Every lane is drawn against the *shared* axis' buckets, so a bar in the same column in
// two lanes means the same week in both. Lanes are ordered by when each Story's coverage
// began, which is the order the events themselves started in.

// One lane: the Story it belongs to, its reporting against the shared axis, and its own
// rows. The heading is a link, because a lane is a way into the Story — where its analysis
// and its own timeline live (#64).
function Lane({
  lane,
  points,
  peak,
  periodLabel,
}: {
  lane: SearchTimelineLane;
  points: TimelinePoint[];
  peak: number;
  periodLabel: string;
}) {
  const headingId = useId();
  return (
    <section className="timeline-lane" aria-labelledby={headingId}>
      <div className="timeline-lane-head">
        <h2 id={headingId}>
          <Link to={`/stories/${lane.story.id}`}>{lane.story.title}</Link>
        </h2>
        {/* The bars' quantity in words, because a bar row states a shape and nothing else
            (DESIGN.md's Redundant Signal Rule). A measurement, like every other register
            head's folio — the Story's own facts are stated on the Story. */}
        <p className="timeline-lane-folio">
          {points.length} matching report{points.length === 1 ? "" : "s"}
        </p>
      </div>
      <TimelineVolume
        counts={lane.volume}
        peak={peak}
        label={`${lane.story.title}: ${points.length} matching reports ${periodLabel}, on the same axis as every other Story here.`}
      />
      <EntryList>
        {points.map((point) => (
          <ArticleEntry key={point.id} article={point} />
        ))}
      </EntryList>
    </section>
  );
}

export default function SearchTimeline() {
  // Same URL-as-state contract as /search, so the two readings of one query are one address
  // bar: "q" survives Clear filters here for the same reason it does there, and so does the
  // sort — this page has no sort control, but it hands the query back to the reading that does.
  const list = useListQueryParams(["q", "sort"]);
  const q = list.get("q");

  const query = useQuery({
    queryKey: ["search-timeline", { q, category: list.category, dateFrom: list.dateFrom, dateTo: list.dateTo }],
    queryFn: () =>
      searchTimeline({
        q,
        category: list.category || undefined,
        dateFrom: list.dateFrom || undefined,
        dateTo: list.dateTo || undefined,
      }),
    enabled: q.trim().length > 0,
  });

  const timeline = query.data;
  // The lanes share the whole set's peak, so a tall bar means the same count in every
  // lane on the page.
  const peak = Math.max(...(timeline?.volume.map((bucket) => bucket.count) ?? []), 1);
  const periodLabel = PERIOD_LABELS[timeline?.granularity ?? "day"];

  return (
    <IndexPage
      title="Search timeline"
      // The way back to the ranked reading of the same query, carrying the query with it:
      // switching how you read a search should never mean typing it again.
      action={
        <Link className="index-switch" to={`/search${list.queryString ? `?${list.queryString}` : ""}`}>
          Read as a ranked list
        </Link>
      }
    >
      <FilterRegister label="Search and filter reporting on a timeline">
        <SearchTermFilter value={q} onChange={(value) => list.updateFilter("q", value)} />{" "}
        <CategoryFilter value={list.category} onChange={(value) => list.updateFilter("category", value)} />{" "}
        {/* The axis' own filter: it narrows what the timeline spans, not just which rows
            are listed under it. */}
        <DateRangeFilter
          label="Published from"
          from={list.dateFrom}
          to={list.dateTo}
          onChange={list.updateFilter}
        />
      </FilterRegister>

      {/* The same three empty states /search distinguishes — nothing asked for, a term
          that matched nothing, filters that excluded everything — plus a failed request,
          which says something different again. */}
      {!q.trim() && (
        <EmptyState>Enter a search term to lay the matching reporting on a timeline.</EmptyState>
      )}
      {query.isPending && q.trim() && <PendingState>Laying the matches on a timeline…</PendingState>}
      {query.isError && (
        <RetryableError
          message={`Could not build this timeline: ${(query.error as Error).message}`}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      )}
      {timeline && timeline.points.length === 0 && (
        <EmptyState>
          <p>No reporting matches &ldquo;{q}&rdquo;, so there is nothing to put on an axis.</p>
          {list.hasFilters && (
            <button type="button" onClick={list.clearFilters}>
              Clear filters
            </button>
          )}
        </EmptyState>
      )}
      {timeline && timeline.points.length > 0 && (
        <>
          <p className="record-prose">
            Matching reporting {periodLabel} across {timeline.lanes.length}{" "}
            {timeline.lanes.length === 1 ? "Story" : "Stories"}, every lane on the one axis below, so
            coverage that ran at the same time reads as parallel.{" "}
            {/* The cap is stated rather than hidden: an axis is a set and cannot page, so a
                broad query is answered with its most relevant matches — and the span is
                theirs too, not the whole match set's (see the endpoint). */}
            {timeline.total > timeline.points.length &&
              `Showing the ${timeline.points.length} most relevant of ${timeline.total} matches, so the axis spans those.`}
          </p>
          <TimelineVolume
            counts={timeline.volume.map((bucket) => bucket.count)}
            peak={peak}
            label={`All matching reporting ${periodLabel} across ${timeline.volume.length} periods, at most ${peak} in one.`}
          />
          <TimelineAxis from={timeline.from} to={timeline.to} granularity={timeline.granularity} />
          {timeline.lanes.map((lane) => (
            <Lane
              key={lane.story.id}
              lane={lane}
              points={timeline.points.filter((point) => point.storyId === lane.story.id)}
              peak={peak}
              periodLabel={periodLabel}
            />
          ))}
        </>
      )}
    </IndexPage>
  );
}
