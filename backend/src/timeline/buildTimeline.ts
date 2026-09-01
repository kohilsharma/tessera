import type { Article } from "../entities/Article";
import type { GenerationLens } from "../entities/GenerationRun";
import { toPublicArticle } from "../lib/articleView";

// CONTEXT.md "Timeline": a *computed* read view of Articles ordered over time. Not
// generation — nothing here calls a model, and the whole view is assembled from rows
// that already exist, so it costs a query per read and nothing else (ADR-0020).
//
// The seam takes a **set of Articles**, never a query. That is the whole reason this
// file exists rather than a block inside routes/stories.ts: the search timeline (#65)
// lays the matching Articles out on one axis grouped into a lane per Story, and a
// per-lane call would bucket each lane against its own span — parallel events would
// stop reading as parallel. One axis over the whole set, with `storyId` echoed on each
// point so a caller that has lanes can group them, is what makes the second consumer
// need no second implementation.

// What happened *to* the reporting, on the same axis as the reporting itself: the two
// analytical events a Story accumulates. Both are facts about the Story's history, not
// claims — a run's Lens is stated, its claims are not, and reaching those still goes
// through generation's own reader check (generation/readerRun.ts).
export type TimelineEvent =
  | { kind: "evidence_frozen"; id: string; at: Date; articleCount: number }
  | { kind: "analysis_completed"; id: string; at: Date; lens: GenerationLens };

export type TimelineGranularity = "hour" | "day" | "week";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PERIODS = [
  ["hour", HOUR_MS],
  ["day", DAY_MS],
  ["week", 7 * DAY_MS],
] as const satisfies readonly (readonly [TimelineGranularity, number])[];

// The granularity is chosen from the span rather than fixed, because a Story that ran
// for six hours and one that ran for six months are both ordinary and one bucket size
// cannot draw both: the finest period that keeps the overlay under this many bars wins.
// A week is the floor, so a span past ~14 months does draw more than this — unreachable
// in a corpus whose firehose half rolls over weekly (ADR-0028), and the honest place to
// widen it is a coarser period here, not a cap that would mislabel the bars.
const MAX_BUCKETS = 60;

// The count both the granularity choice and the drawn axis are read off. One definition,
// because the two drifting by one would pick a period against a bar count nobody draws.
function bucketCount(from: number, to: number, size: number): number {
  return Math.floor((to - alignedOrigin(from, size)) / size) + 1;
}

export type Timeline = {
  // The axis, spanning the reporting *and* the events — an analysis written a week
  // after the last Article is still on the axis, because that is when it happened.
  // Null for a Story with nothing datable on it at all.
  from: Date | null;
  to: Date | null;
  granularity: TimelineGranularity;
  points: (ReturnType<typeof toPublicArticle> & { storyId: string | null })[];
  events: TimelineEvent[];
  // Reporting per period, zero-count buckets included: a lull in coverage is a fact
  // about the Story and a chart that skips it draws a straight line through it.
  //
  // Tone is deliberately absent. `articles.tone` comes from GDELT, and it reaches a
  // Story member only by cross-connector enrichment, which measured zero on
  // 2026-09-01 (#59) — so a tone axis here would be a structurally empty one. The
  // reader is told that in a line rather than shown a flat chart.
  volume: { periodStart: Date; count: number }[];
};

function byTime<T>(at: (item: T) => Date, id: (item: T) => string) {
  // Ties broken on id, so a re-read of the same set orders identically — several
  // Articles sharing a `publishedAt` to the second is ordinary in a feed.
  return (a: T, b: T) => at(a).getTime() - at(b).getTime() || id(a).localeCompare(id(b));
}

export function buildTimeline(articles: Article[], events: TimelineEvent[]): Timeline {
  const points = [...articles]
    .sort(byTime((a) => a.publishedAt, (a) => a.id))
    .map((article) => ({ ...toPublicArticle(article), storyId: article.storyId }));
  const ordered = [...events].sort(byTime((e) => e.at, (e) => e.id));

  const times = [...points.map((p) => p.publishedAt.getTime()), ...ordered.map((e) => e.at.getTime())];
  if (times.length === 0) {
    return { from: null, to: null, granularity: "day", points, events: ordered, volume: [] };
  }

  const from = Math.min(...times);
  const to = Math.max(...times);
  const [granularity, size] =
    PERIODS.find(([, ms]) => bucketCount(from, to, ms) <= MAX_BUCKETS) ?? PERIODS[PERIODS.length - 1];

  const origin = alignedOrigin(from, size);
  const volume = Array.from({ length: bucketCount(from, to, size) }, (_, index) => ({
    periodStart: new Date(origin + index * size),
    count: 0,
  }));
  for (const point of points) {
    volume[Math.floor((point.publishedAt.getTime() - origin) / size)].count += 1;
  }

  return { from: new Date(from), to: new Date(to), granularity, points, events: ordered, volume };
}

// Buckets start on a clean boundary so the first one is not a ragged offset of the
// first Article's minute — on the hour for hourly, on the day for daily and weekly.
// Weeks run from the day coverage began rather than from a calendar weekday: the axis
// is this Story's own span, and epoch-aligned weeks would start every one on a
// Thursday for no reason a reader could see.
function alignedOrigin(from: number, size: number): number {
  const anchor = Math.min(size, DAY_MS);
  return Math.floor(from / anchor) * anchor;
}
