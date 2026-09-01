import { XMLParser } from "fast-xml-parser";
import { decodeEntities } from "./decodeEntities";

// RSS 2.0 only. ADR-0018 makes feed curation the cheapest lever on text quality,
// and the curated list (seedData/corpus.ts) is RSS 2.0 throughout — so Atom and
// RSS 1.0/RDF are not parsed rather than half-parsed. A feed that is neither
// throws, and the run records it as a failure with a legible reason.
//
// A dependency rather than a hand-rolled tag scan: a feed is untrusted input from
// the open internet, and regex over XML is the flimsier algorithm at the same
// size. fast-xml-parser v4 is pinned (v5 pulls six transitive dependencies).
const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  // Off, so a headline that is nothing but digits stays a string and a date-like
  // value is never silently coerced.
  parseTagValue: false,
  htmlEntities: true,
  // #61. fast-xml-parser's entity guard defaults to 1,000 expansions *per
  // document*, and that number is a function of a feed's legitimate size rather
  // than of anything hostile: the Guardian World feed carries 2,024 ordinary
  // `&amp;`/`&#8217;` references across 45 items, tripped the cap at 1,008, and so
  // failed every run since it was seeded. The count is raised to admit a real feed
  // — several times the largest of the ten curated ones — and stays finite so a
  // pathological document still terminates.
  //
  // The guard against entity *amplification* (billion laughs) is the other three
  // bounds, none of which grow with a longer feed: one entity's declared size, how
  // deeply entities may nest, and the total expanded characters. A feed is
  // untrusted input from the open internet, so they are restated explicitly at
  // fast-xml-parser's own documented defaults — passing an object here defaults
  // `maxExpansionDepth` to 10,000 and `maxTotalExpansions` to Infinity, which would
  // remove the protection this comment is about.
  processEntities: {
    enabled: true,
    maxTotalExpansions: 100_000,
    maxExpansionDepth: 10,
    maxEntitySize: 10_000,
    maxExpandedLength: 100_000,
    maxEntityCount: 1_000,
  },
});

export type FeedItem = {
  title: string;
  // Not yet canonicalized: normalization is the run's job, so the parser stays
  // a parser and a URL is canonicalized in exactly one place.
  link: string | null;
  publishedAt: Date | null;
  // content:encoded where the publisher emits it, description otherwise, with
  // markup stripped. Null when the item carries no text at all.
  text: string | null;
};

export type ParsedFeed = {
  channelTitle: string | null;
  // The nearest thing RSS has to a cursor: when the publisher last rebuilt the
  // feed. Recorded on the IngestionRun; GKG's real window cursor lands in #45.
  lastBuildDate: string | null;
  items: FeedItem[];
};

// A tag present once parses to a value, twice to an array — so a one-item feed
// and a many-item feed have different shapes unless normalized here.
function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// CDATA content is never entity-decoded by an XML parser (that is what CDATA
// means), so content:encoded arrives as raw HTML with its own entities intact.
// Tags out, then the handful of entities that survive, then whitespace collapsed
// — analysisText feeds tsvector and, later, evidence text, and markup in either
// is noise a human reader would never have seen.
function stripHtml(html: string): string {
  return decodeEntities(
    html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Feeds date items in RFC-822 (`pubDate`) or ISO-8601 (`dc:date`). An
// unparseable date is not defaulted to "now": publishedAt is what the timeline
// (ADR-0020) orders by, and a fabricated date is a claim we cannot support. The
// caller fails the item instead.
function parseDate(value: unknown): Date | null {
  const raw = textOf(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseRssFeed(xml: string): ParsedFeed {
  const document = parser.parse(xml) as Record<string, unknown>;
  const rss = document.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (!channel) throw new Error("Not an RSS 2.0 feed: no rss > channel element");

  const items = toArray(channel.item).map((raw): FeedItem => {
    const item = raw as Record<string, unknown>;
    const encoded = textOf(item["content:encoded"]);
    const description = textOf(item.description);
    const body = encoded ?? description;
    return {
      title: textOf(item.title) ?? "",
      link: textOf(item.link) ?? textOf(item.guid),
      publishedAt: parseDate(item.pubDate) ?? parseDate(item["dc:date"]),
      text: body === null ? null : stripHtml(body) || null,
    };
  });

  return {
    channelTitle: textOf(channel.title),
    lastBuildDate: textOf(channel.lastBuildDate),
    items,
  };
}
