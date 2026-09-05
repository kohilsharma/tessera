import { useId, type CSSProperties } from "react";
import { LENS_LABELS, type Timeline, type TimelineEvent } from "../api/client";
import { ArticleEntry, DateStamp, EntryLedger } from "./indexArchetype";
import { peakOf } from "./scale";
import { EntryList } from "./uiStates";

// CONTEXT.md "Timeline": a Story's reporting ordered over time with the analytical
// events that happened to it on the same axis (#64). Rendered here rather than in
// StoryDetail because the search timeline (#65) draws the same thing over a set of
// Articles drawn from many Stories — the backend seam takes a set rather than a query
// for that reason, and a second rendering of it would be the same drift on the other
// side of the wire.
//
// The four UI states stay the consumer's own, as with every other shared piece
// (uiStates.tsx): a Story register and a search route reach an empty timeline for
// different reasons and say so in different words.

// Shared with the search timeline (#65), which states the same period in the same words
// over a set drawn from many Stories.
export const PERIOD_LABELS: Record<Timeline["granularity"], string> = {
  hour: "per hour",
  day: "per day",
  week: "per week",
};

// One bucket's own name (#96), so a bar can say which span it stands for and not only how
// tall it is. Buckets are contiguous and equal (buildTimeline.ts), so the start names the
// whole span to a reader who has been told the granularity — which every drawing states.
// An hourly bucket is a span inside one day, so that one alone carries a time.
const PERIOD_NAMES: Record<Timeline["granularity"], (at: Date) => string> = {
  hour: (at) => at.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
  day: (at) => at.toLocaleDateString(),
  week: (at) => `Week of ${at.toLocaleDateString()}`,
};

export function periodName(periodStart: string, granularity: Timeline["granularity"]) {
  return PERIOD_NAMES[granularity](new Date(periodStart));
}

// What a bucket *holds*, as against what it is named after: from its own start to the next
// one's, or to the end of the axis for the last. Half-open, so reporting published exactly
// on a boundary belongs to one period rather than to two. It sits here beside `periodName`
// because both are the same piece of knowledge — what one bucket on this axis means — and a
// page that had to work that out for itself would be deriving bucket semantics twice.
//
// The bucket is found by lookup rather than by arithmetic, so a `periodStart` from a
// different axis (a changed term, a changed filter, a hand-written link) matches nothing
// and yields no span, instead of silently landing on whichever bucket is nearby. Compared
// as instants, because the same instant arrives with milliseconds from the API and without
// them from a link someone typed.
export function periodSpan(
  buckets: Timeline["volume"],
  granularity: Timeline["granularity"],
  wanted: string,
): { start: string; name: string; from: number; to: number } | null {
  if (!wanted) return null;
  const index = buckets.findIndex((bucket) => Date.parse(bucket.periodStart) === Date.parse(wanted));
  if (index < 0) return null;
  const { periodStart } = buckets[index];
  const next = buckets[index + 1]?.periodStart;
  return {
    // The axis' own spelling of it, not the caller's: what came in may be the same instant
    // written differently, and it is this one that has to match a bucket to select it.
    start: periodStart,
    name: periodName(periodStart, granularity),
    from: Date.parse(periodStart),
    to: next ? Date.parse(next) : Infinity,
  };
}

// Makes the bars the way in rather than a picture of it (#96). One radio per bucket, which
// is the platform's own answer to "pick one of these": the group is a single tab stop the
// arrow keys move inside, where sixty buttons would be sixty tab stops — and an axis runs
// to sixty buckets (MAX_BUCKETS). The caller owns the selection because it lives in the
// URL, so a narrowed axis is a link.
export type VolumePeriods = {
  periodStarts: string[];
  granularity: Timeline["granularity"];
  selected: string | null;
  onSelect: (periodStart: string) => void;
};

// Reporting per period as a row of bars on one baseline. Its own component because the
// search timeline (#65) draws this once for the whole match set and once per Story lane,
// all against the same buckets — `peak` is the caller's for exactly that reason: lanes
// scaled to their own maxima would draw two different quantities at the same height.
//
// `label` is the caller's too: what the bars measure differs per drawing, and a bar row
// is a picture until something states what it is (DESIGN.md's Redundant Signal Rule).
//
// Without `periods` it stays exactly that picture: a Story's own register (#64) has one
// axis and nothing to narrow to, so its bars answer to nothing and claim no affordance.
export function TimelineVolume({
  counts,
  peak,
  label,
  periods,
}: {
  counts: number[];
  peak: number;
  label: string;
  periods?: VolumePeriods;
}) {
  // One name per row, so the arrow keys walk this row's periods and never step into the
  // next lane's — every lane on the search timeline draws its own row of the same buckets.
  const group = useId();

  if (!periods) {
    return (
      <div className="timeline-volume" role="img" aria-label={label}>
        {counts.map((count, index) => (
          <i key={index} style={{ "--share": count / peak } as CSSProperties} />
        ))}
      </div>
    );
  }

  return (
    <div className="timeline-volume" role="radiogroup" aria-label={label}>
      {counts.map((count, index) => {
        const start = periods.periodStarts[index];
        return (
          // The whole column is the target, not the drawn bar: a one-count bucket on a tall
          // axis draws a sliver, and a sliver is not something a hand can hit.
          <label key={start} className="timeline-period" style={{ "--share": count / peak } as CSSProperties}>
            <input
              type="radio"
              name={group}
              checked={periods.selected === start}
              onChange={() => periods.onSelect(start)}
            />
            {/* A lull is selectable like any other period — "who was quiet that week" is a
                question about the axis — so the name states the count even when it is 0. */}
            <span className="a11y-only">
              {periodName(start, periods.granularity)}: {count} report{count === 1 ? "" : "s"}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// The axis' two ends, stated rather than assumed: a caller may hand this a set whose only
// members carry no date, and a row of bars over an unnamed span is a picture of nothing.
// Both ends state the time on an hourly axis, which is a span *inside* one day — the same
// date twice would name no span at all.
export function TimelineAxis({
  from,
  to,
  granularity,
}: {
  from: string | null;
  to: string | null;
  granularity: Timeline["granularity"];
}) {
  if (!from || !to) return null;
  return (
    <p className="timeline-axis">
      <span>
        <DateStamp iso={from} withTime={granularity === "hour"} />
      </span>
      <span>
        <DateStamp iso={to} withTime={granularity === "hour"} />
      </span>
    </p>
  );
}

// An analytical event names itself and states its own facts in the register every
// other row uses. It has no record page of its own — an EvidenceSet is frozen inside
// a run, not browsable — so the row's name is a name and not a link.
function EventRow({ event }: { event: TimelineEvent }) {
  const [name, fact] =
    event.kind === "evidence_frozen"
      ? ["Evidence frozen", { term: "Articles", value: event.articleCount }]
      : ["Analysis completed", { term: "Lens", value: LENS_LABELS[event.lens] }];
  return (
    <li className="entry">
      <p className="entry-name">{name}</p>
      <EntryLedger meta={[fact, { term: "Recorded", value: <DateStamp iso={event.at} /> }]} />
    </li>
  );
}

export function TimelineRegister({ timeline }: { timeline: Timeline }) {
  // One axis, reporting and events interleaved on it. ISO-8601 in UTC is what the API
  // sends, and it sorts lexically, so this needs no date parsing to order.
  const marks = [
    ...timeline.points.map((point) => ({
      at: point.publishedAt,
      node: <ArticleEntry key={point.id} article={point} />,
    })),
    ...timeline.events.map((event) => ({ at: event.at, node: <EventRow key={event.id} event={event} /> })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const peak = peakOf(timeline.volume.map((bucket) => bucket.count));

  return (
    <>
      {/* ADR-0028/#59: tone is GDELT's, and it reaches a clustered Story only by
          cross-connector enrichment, which measured zero. An empty tone axis would
          claim a measurement Tessera does not have, so the register says so instead. */}
      <p className="record-prose">
        Reporting {PERIOD_LABELS[timeline.granularity]}, with the analysis this Story has been
        through on the same axis. Tone is not shown: it arrives only on reporting the GDELT
        firehose also saw.
      </p>
      {/* Drawn only where there is reporting to draw: a set whose only marks are
          analytical events carries no volume at all (buildTimeline.ts empties it for
          exactly that case), and an empty ruled box would state a measurement of
          nothing. */}
      {timeline.volume.length > 0 && (
        <TimelineVolume
          counts={timeline.volume.map((bucket) => bucket.count)}
          peak={peak}
          label={`Reporting volume ${PERIOD_LABELS[timeline.granularity]} across ${timeline.volume.length} periods, at most ${peak} in one.`}
        />
      )}
      <TimelineAxis from={timeline.from} to={timeline.to} granularity={timeline.granularity} />
      <EntryList total={marks.length}>{marks.map((mark) => mark.node)}</EntryList>
    </>
  );
}
