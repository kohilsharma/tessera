import type { Publisher, PublisherLeaning } from "../entities/Publisher";

// CONTEXT.md "Publisher Leaning" · ADR-0035. A leaning is a *cited claim about a
// publisher*: a rating somebody else published, reproduced with their name on
// it. This module is the whole of that claim — who said it, what they said, and
// the one shape it may leave the API in. Nothing here consults a model, and
// nothing above it may invent a rating: `leaningFor` is the only writer.

// The credit AllSides' CC BY-NC 4.0 licence asks for, in the pieces a page
// renders: `name` beside the rating itself, the rest as the attribution line.
// One source today. The shape is per-row rather than global because ADR-0035
// records a commercially-licensed replacement as a future requirement — swapping
// rater then means a second entry here and a re-seed, not a schema change.
export const LEANING_SOURCES = {
  allsides: {
    name: "AllSides",
    // AllSides' documented online attribution: title, owner, and when we read it.
    attribution: "AllSides Media Bias Ratings™. AllSides Technologies, Inc. Retrieved September 2026.",
    url: "https://www.allsides.com/media-bias/media-bias-ratings",
    licence: "CC BY-NC 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
  },
} as const;

export type LeaningSourceKey = keyof typeof LEANING_SOURCES;
export type LeaningSource = (typeof LEANING_SOURCES)[LeaningSourceKey];

// AllSides' own published wording for each rating. It lives beside the rating
// rather than in the frontend's label tables (TERMS_CLASS_LABEL and friends)
// because it is part of the quotation, not a presentation choice: a rating
// rendered under a word AllSides does not use is a misquote of the source.
const LEANING_LABELS: Record<PublisherLeaning, string> = {
  left: "Left",
  lean_left: "Lean Left",
  center: "Center",
  lean_right: "Lean Right",
  right: "Right",
};

// Read off AllSides' own per-source pages (allsides.com/news-source/…) on
// 2026-09-04, one page per row. Only domains actually read that way are here:
// a rating recalled rather than read is exactly the invented claim about a real
// publisher this feature exists to avoid, so the table is short on purpose.
// It is a curated slice of AllSides' 2,400+ ratings — the outlets the seeded RSS
// feeds resolve to plus the US nationals the GDELT firehose carries most — which
// is why *unrated* is the normal answer and has to read as an honest state
// rather than a gap. Extend it by reading a page, never by inference.
export const ALLSIDES_RATED_DOMAINS: Record<string, PublisherLeaning> = {
  "theguardian.com": "left",
  "aljazeera.com": "lean_left",
  "apnews.com": "lean_left",
  "cnn.com": "lean_left",
  "nbcnews.com": "lean_left",
  "npr.org": "lean_left",
  "politico.com": "lean_left",
  "washingtonpost.com": "lean_left",
  "bbc.co.uk": "center",
  "bbc.com": "center",
  "thehill.com": "center",
  "wsj.com": "center",
  "nypost.com": "lean_right",
  "washingtonexaminer.com": "lean_right",
  "washingtontimes.com": "lean_right",
  "dailywire.com": "right",
  "foxnews.com": "right",
  "newsmax.com": "right",
};

// The three-way axis DESIGN.md paints with `--left --centre --right`, which
// AllSides' five ratings collapse onto. Decided here and served rather than
// re-derived per surface: "Lean Left counts as left" is a claim about the data,
// and #86's coverage spectrum counting it one way while a mark painted it another
// would be a disagreement nobody could see. British spelling because the band is
// *our* axis and takes its token's name; the ratings keep AllSides' spelling
// because they are AllSides' words.
export type LeaningBand = "left" | "centre" | "right";

const LEANING_BANDS: Record<PublisherLeaning, LeaningBand> = {
  left: "left",
  lean_left: "left",
  center: "centre",
  lean_right: "right",
  right: "right",
};

export type SourcedLeaning = { leaning: PublisherLeaning; leaningSource: LeaningSourceKey };

// The only writer of a leaning. A Publisher's domain is `publisherDomain()`'s
// output — lowercased, `www.` stripped — but the firehose also reports a
// newsroom's own section hosts (`edition.cnn.com`, `news.bbc.co.uk`), which are
// the outlet AllSides rated; matching the apex alone would leave most of the
// live corpus unrated over a hosting convention. Matched on the *dot* boundary
// so `notfoxnews.com` is a different publisher, and on the longest match so the
// answer never depends on this object's key order should one rated domain ever
// sit beneath another.
export function leaningFor(domain: string): SourcedLeaning | null {
  const host = domain.toLowerCase().replace(/^www\./, "");
  const rated = Object.keys(ALLSIDES_RATED_DOMAINS)
    .filter((candidate) => host === candidate || host.endsWith(`.${candidate}`))
    .sort((a, b) => b.length - a.length)[0];
  return rated ? { leaning: ALLSIDES_RATED_DOMAINS[rated], leaningSource: "allsides" } : null;
}

export type PublicLeaning = { rating: PublisherLeaning; label: string; band: LeaningBand; source: LeaningSource };

// The one shape a rating leaves the API in, and it cannot carry a rating without
// the credit beside it — CONTEXT.md's "always displayed with its source named"
// as a type rather than a convention each page could forget. Both columns are
// varchar, so a hand-edited row can hold half a claim or a source nothing here
// recognises; either way the answer is *unrated*, because an uncredited verdict
// about a real publisher is worse than no verdict at all.
export function toPublicLeaning(publisher: Pick<Publisher, "leaning" | "leaningSource">): PublicLeaning | null {
  if (!publisher.leaning || !publisher.leaningSource) return null;
  const label = LEANING_LABELS[publisher.leaning];
  const source = LEANING_SOURCES[publisher.leaningSource as LeaningSourceKey];
  if (!label || !source) return null;
  return { rating: publisher.leaning, label, band: LEANING_BANDS[publisher.leaning], source };
}