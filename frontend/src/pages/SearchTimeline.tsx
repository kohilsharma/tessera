import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Link } from "react-router-dom";
import { searchTimeline, type SearchTimelineLane, type TimelinePoint } from "../api/client";
import { ArticleEntry, FilterRegister, IndexPage } from "../components/indexArchetype";
import { CategoryFilter, DateRangeFilter, SearchTermFilter, useListQueryParams } from "../components/listControls";
import { peakOf } from "../components/scale";
import {
  PERIOD_LABELS,
  periodSpan,
  TimelineAxis,
  TimelineVolume,
  type VolumePeriods,
} from "../components/timelineRegister";
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
//
// #96 made it a destination of its own rather than a link off /search, which is why it has
// a landing state at all: an arrival with nothing typed has to say what the page draws.
// And the bars became the way in — pick one and every lane narrows to that period, so the
// question "who was covering this that week" is answered by pointing at the week. The
// selection narrows the *lists* only: the bars and the axis keep drawing the whole set,
// because an axis that shrank to its own selection would leave nothing to compare against
// and no way back.

// One lane: the Story it belongs to, its reporting against the shared axis, and its own
// rows. The heading is a link, because a lane is a way into the Story — where its analysis
// and its own timeline live (#64).
//
// `whole` beside `points` because a narrowed lane must still state the coverage it has:
// "1 of 2" is a Story with two reports being read one period at a time, where a bare "1"
// is a Story with one report.
function Lane({
  lane,
  points,
  whole,
  peak,
  periods,
  narrowed,
}: {
  lane: SearchTimelineLane;
  points: TimelinePoint[];
  whole: number;
  peak: number;
  periods: VolumePeriods;
  narrowed: boolean;
}) {
  const headingId = useId();
  const periodLabel = PERIOD_LABELS[periods.granularity];
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
          {narrowed ? `${points.length} of ${whole}` : whole} matching report{whole === 1 ? "" : "s"}
        </p>
      </div>
      {/* Drawn from the lane's own volume, which never narrows: these bars are how a reader
          picks a different period, so a narrowed lane keeps every one of them. */}
      <TimelineVolume
        counts={lane.volume}
        peak={peak}
        label={`${lane.story.title}: ${whole} matching report${whole === 1 ? "" : "s"} ${periodLabel}, on the same axis as every other Story here.`}
        periods={periods}
      />
      {/* A lane with nothing in the selected period says so and stays. Dropping it would
          answer "who else was covering this" by hiding the Stories that were quiet, which
          is the one reading the lanes exist to make possible. */}
      {points.length === 0 ? (
        <p className="timeline-lane-quiet">No matching reporting in this period.</p>
      ) : (
        <EntryList total={whole}>
          {points.map((point) => (
            <ArticleEntry key={point.id} article={point} />
          ))}
        </EntryList>
      )}
    </section>
  );
}

export default function SearchTimeline() {
  // Same URL-as-state contract as /search, so the two readings of one query are one address
  // bar: "q" survives Clear filters here for the same reason it does there, and so does the
  // sort — this page has no sort control and the endpoint pins the axis to relevance, so the
  // param is carried rather than used: it is the sibling reading's, held for the trip back.
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
  const peak = peakOf(timeline?.volume.map((bucket) => bucket.count) ?? []);
  const granularity = timeline?.granularity ?? "day";
  const periodLabel = PERIOD_LABELS[granularity];
  const buckets = timeline?.volume ?? [];

  // The selected period rides in the URL, so a narrowed axis is a link like every other
  // state on this page. What that value means against the drawn buckets is the register's
  // knowledge, not the page's (timelineRegister.tsx): a value naming no bucket on this axis
  // — a changed term, a changed filter, a stale link — yields no span, so the page heals
  // itself rather than narrowing to whichever bucket happens to be nearby.
  const span = periodSpan(buckets, granularity, list.get("period"));
  const selectPeriod = (periodStart: string) => list.updateFilter("period", periodStart);
  const periods: VolumePeriods = {
    periodStarts: buckets.map((bucket) => bucket.periodStart),
    granularity,
    selected: span?.start ?? null,
    onSelect: selectPeriod,
  };

  const inSpan = (point: TimelinePoint) =>
    !span || (Date.parse(point.publishedAt) >= span.from && Date.parse(point.publishedAt) < span.to);
  const shown = timeline?.points.filter(inSpan) ?? [];

  return (
    <IndexPage
      title="Timeline"
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
          which says something different again.
          Since #96 the first of those is a landing state rather than a prompt: a reader
          arriving from the nav has typed nothing and may never have seen this drawing, so
          it says what the page makes, where the term goes, and where to go find one. */}
      {!q.trim() && (
        <EmptyState>
          <p>
            A timeline draws the reporting that matches a term on one shared axis, one lane per
            Story, so coverage that ran at the same time reads as parallel rather than as one flat
            list. Pick a period from any lane&rsquo;s bars to read that week on its own.
          </p>
          <p>
            Type a term in <strong>Search</strong> above. The date range narrows the axis itself,
            not only the reporting listed under it.
          </p>
          <Link to="/stories">Browse the Stories</Link>
        </EmptyState>
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
            periods={periods}
          />
          <TimelineAxis from={timeline.from} to={timeline.to} granularity={timeline.granularity} />
          {/* Says what the bars did, because picking one changes the lists and not the
              drawing a sighted reader just clicked — and carries the way out, since a radio
              cannot be un-picked by picking it again. */}
          {span && (
            <p className="timeline-period-note" role="status">
              Narrowed to {span.name}: {shown.length} of {timeline.points.length} matching report
              {timeline.points.length === 1 ? "" : "s"}.{" "}
              <button type="button" onClick={() => selectPeriod("")}>
                Show every period
              </button>
            </p>
          )}
          {timeline.lanes.map((lane) => {
            const lanePoints = timeline.points.filter((point) => point.storyId === lane.story.id);
            return (
              <Lane
                key={lane.story.id}
                lane={lane}
                points={span ? lanePoints.filter(inSpan) : lanePoints}
                whole={lanePoints.length}
                peak={peak}
                periods={periods}
                narrowed={Boolean(span)}
              />
            );
          })}
        </>
      )}
    </IndexPage>
  );
}
