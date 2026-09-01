import type { CSSProperties } from "react";
import type { GenerationLens, Timeline, TimelineEvent } from "../api/client";
import { ArticleEntry, EntryLedger } from "./indexArchetype";
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

const LENS_LABELS: Record<GenerationLens, string> = {
  student_context: "Student context",
  investor_implication: "Investor implication",
};

const PERIOD_LABELS: Record<Timeline["granularity"], string> = {
  hour: "per hour",
  day: "per day",
  week: "per week",
};

// A row's date, in the register every other row states one in. The axis' two ends pass
// `withTime`, because an hourly axis is a span *inside* a day and stating the same date
// at both ends of it would name no span at all; a row keeps the date alone, which is
// what ArticleEntry states beside it.
function stamp(iso: string, withTime = false) {
  const at = new Date(iso);
  return (
    <time dateTime={iso}>
      {withTime ? at.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : at.toLocaleDateString()}
    </time>
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
      <EntryLedger meta={[fact, { term: "Recorded", value: stamp(event.at) }]} />
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
          analytical events has no volume, and an empty ruled box would state a
          measurement of nothing. */}
      {timeline.volume.length > 0 && (
        <div
          className="timeline-volume"
          role="img"
          aria-label={`Reporting volume ${PERIOD_LABELS[timeline.granularity]} across ${timeline.volume.length} periods, at most ${peak} in one.`}
        >
          {timeline.volume.map((bucket) => (
            <i key={bucket.periodStart} style={{ "--share": bucket.count / peak } as CSSProperties} />
          ))}
        </div>
      )}
      {/* The axis' span is stated, not assumed: a caller may hand this a set whose
          only members carry no date, and a bar row over an unnamed span is a picture
          of nothing. */}
      {timeline.from && timeline.to && (
        <p className="timeline-axis">
          <span>{stamp(timeline.from, timeline.granularity === "hour")}</span>
          <span>{stamp(timeline.to, timeline.granularity === "hour")}</span>
        </p>
      )}
      <EntryList>{marks.map((mark) => mark.node)}</EntryList>
    </>
  );
}
