import type { CSSProperties } from "react";
import { LENS_LABELS, type Timeline, type TimelineEvent } from "../api/client";
import { ArticleEntry, DateStamp, EntryLedger } from "./indexArchetype";
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

// Reporting per period as a row of bars on one baseline. Its own component because the
// search timeline (#65) draws this once for the whole match set and once per Story lane,
// all against the same buckets — `peak` is the caller's for exactly that reason: lanes
// scaled to their own maxima would draw two different quantities at the same height.
//
// `label` is the caller's too: what the bars measure differs per drawing, and a bar row
// is a picture until something states what it is (DESIGN.md's Redundant Signal Rule).
export function TimelineVolume({ counts, peak, label }: { counts: number[]; peak: number; label: string }) {
  return (
    <div className="timeline-volume" role="img" aria-label={label}>
      {counts.map((count, index) => (
        <i key={index} style={{ "--share": count / peak } as CSSProperties} />
      ))}
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

  const peak = Math.max(...timeline.volume.map((bucket) => bucket.count), 1);

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
      <EntryList>{marks.map((mark) => mark.node)}</EntryList>
    </>
  );
}
