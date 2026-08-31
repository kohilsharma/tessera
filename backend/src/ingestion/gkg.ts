import { unzipSync } from "fflate";
import type { GkgAnnotationKind, GkgLocationDetail } from "../entities/GkgAnnotation";
import { decodeEntities } from "./decodeEntities";

// GDELT GKG 2.1 (ADR-0018): the 15-minute firehose is the backbone of the entity
// substrate Phase 3 clustering and Phase 3.5's graph both need. A window is one
// zipped, tab-separated file of 27 fields with no header row, one row per document
// GDELT's NLP saw in those 15 minutes.
//
// Only the fields Tessera reads are named. GCAM (field 18) is the deliberate
// omission: measured at 71.5% of all bytes in a live window and read by nothing in
// ADR-0019 or ADR-0020 (ADR-0024), so it is never carried out of this parser.
const FIELD_COUNT = 27;
const FIELD = {
  recordId: 0, // GKGRECORDID
  date: 1, // V2.1DATE — when GDELT saw the document, YYYYMMDDHHMMSS in UTC
  sourceDomain: 3, // V2SOURCECOMMONNAME — the publisher's source domain
  documentIdentifier: 4, // V2DocumentIdentifier — the article URL
  themes: 8, // V2ENHANCEDTHEMES — `THEME,charOffset;`
  locations: 10, // V2ENHANCEDLOCATIONS — nine `#`-separated components per occurrence
  persons: 12, // V2ENHANCEDPERSONS — `Name,charOffset;`
  organizations: 14, // V2ENHANCEDORGANIZATIONS — `Name,charOffset;`
  tone: 15, // V1.5Tone — a comma-separated tuple whose first value is average tone
  extrasXml: 26, // V2EXTRASXML — where PAGE_TITLE lives
} as const;

// The V1 fields (7, 9, 11, 13) carry the same names *without* offsets, so the
// enhanced fields above are the ones read: the offset is what makes an occurrence
// distinct from a bare name, and what a co-occurrence self-join needs (#43).

// One GKG Annotation as parsed, before it has an Article to belong to.
export type ParsedAnnotation = {
  kind: GkgAnnotationKind;
  surfaceName: string;
  charOffset: number;
  locationDetail: GkgLocationDetail | null;
};

export type GkgRow = {
  recordId: string | null;
  sourceDomain: string | null;
  // Raw, not canonicalized: normalization belongs to the run, so a URL is
  // canonicalized in exactly one place (same split as rss.ts).
  documentIdentifier: string | null;
  title: string | null;
  publishedAt: Date | null;
  // Average document tone. Retained for the Phase-3.5 timeline overlay
  // (ADR-0020, ADR-0024); nothing reads it yet.
  tone: number | null;
  // The persons, organizations, locations and themes GKG already extracted, as
  // surface-name occurrences (#43). Empty for a row that cannot be read
  // positionally at all.
  annotations: ParsedAnnotation[];
};

export type GkgWindow = { url: string; stamp: string };

// A window is ~3 MB compressed / ~9 MB raw (ADR-0024 measured 8.26 MB). Both
// sides are capped because the source is external and the demo box has ~3 GB free.
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_CSV_BYTES = 32 * 1024 * 1024;

// `lastupdate.txt` is three `size md5 url` lines — export, mentions, and gkg.
// ADR-0018 uses the GKG file alone; the other two are GDELT's event tables.
//
// The file names come out of an unauthenticated response body (GDELT publishes the
// endpoint over plain http), and the URL they name is what the connector then
// downloads. So it must sit on the same host the operator pointed the connector
// at: a body that names somewhere else is rejected rather than fetched.
export function resolveGkgWindowUrl(lastUpdate: string, endpoint: string): GkgWindow {
  const url = lastUpdate
    .split("\n")
    .map((line) => line.trim().split(/\s+/).at(-1) ?? "")
    .find((candidate) => candidate.endsWith(".gkg.csv.zip"));
  if (!url) throw new Error("lastupdate.txt carries no .gkg.csv.zip line");
  const expectedHost = new URL(endpoint).host;
  if (new URL(url).host !== expectedHost) {
    throw new Error(`lastupdate.txt names a file off the connector's own host (${expectedHost}): ${url}`);
  }
  const stamp = /(\d{14})\.gkg\.csv\.zip$/.exec(url)?.[1];
  if (!stamp) throw new Error(`GKG file name carries no 15-minute window stamp: ${url}`);
  return { url, stamp };
}

// #45. The worker is not a 24/7 service (ADR-0015 runs it natively beside the
// demo), so a gap in the firehose is the normal state rather than a fault. Window
// files sit on GDELT's own 15-minute grid, so the names of the missed ones are
// arithmetic: `masterfilelist.txt` is never requested, because it is 127 MB
// downloaded to learn something modulo already knows.
const GKG_WINDOW_MS = 15 * 60 * 1000;

// Two hours. Enough to heal a lunch break, a restart, or a tick whose fleet was
// still draining; short enough that a machine which was off all weekend refuses
// the backfill rather than attempting it — eight windows is already ~25 MB over
// the wire and ~5,000 rows through the per-item path.
export const MAX_CATCH_UP_WINDOWS = 8;

export type GkgCatchUp = {
  // The windows to read, oldest first, ending with the current one. Empty when
  // the cursor already names the current window — GDELT has published nothing
  // since, so there is no file worth downloading.
  stamps: string[];
  // How many windows were passed over for exceeding the cap. Nonzero means
  // reporting was dropped deliberately, which is why the run reports it.
  skippedWindows: number;
};

// GDELT window stamps are fixed-width UTC digits, so a window is a number of
// 15-minute steps and nothing here needs a calendar library.
function formatStamp(at: number): string {
  return new Date(at).toISOString().replace(/\D/g, "").slice(0, 14);
}

// Given the last window this connector finished and the one GDELT is publishing
// now, which windows to read. The cap is what keeps a long absence from turning
// the next run into an unbounded backfill.
export function planGkgCatchUp(cursor: string | null, current: string): GkgCatchUp {
  const currentAt = parseGdeltStamp(current);
  if (!currentAt) throw new Error(`Not a 15-minute window stamp: ${current}`);
  // No cursor at all — a connector's first run. Going live is the only honest
  // option: there is no gap, because there is no history to have a gap in.
  const held = parseGdeltStamp(cursor);
  if (!held) return { stamps: [current], skippedWindows: 0 };
  // Epoch 0 is itself on a 15-minute boundary in UTC, so flooring by the window
  // length lands on GDELT's grid. Without it an off-grid cursor would generate
  // file names GDELT never published.
  const from = Math.floor(held.getTime() / GKG_WINDOW_MS) * GKG_WINDOW_MS;
  const missed = Math.round((currentAt.getTime() - from) / GKG_WINDOW_MS) - 1;
  // Negative covers both "the cursor is the current window" and a cursor ahead of
  // it, which a clock correction upstream can produce.
  if (missed < 0) return { stamps: [], skippedWindows: 0 };
  if (missed > MAX_CATCH_UP_WINDOWS) return { stamps: [current], skippedWindows: missed };
  return {
    stamps: [
      ...Array.from({ length: missed }, (_, step) => formatStamp(from + (step + 1) * GKG_WINDOW_MS)),
      current,
    ],
    skippedWindows: 0,
  };
}

export function isGkgWindowStamp(value: string | null): value is string {
  const parsed = parseGdeltStamp(value);
  return parsed !== null && parsed.getUTCMinutes() % 15 === 0 && parsed.getUTCSeconds() === 0;
}

// A missed window's file sits beside the current one, so its URL is derived from
// the URL GDELT itself named rather than composed from a path of our own — which
// also means it inherits the host check resolveGkgWindowUrl already made.
export function gkgWindowUrl(current: GkgWindow, stamp: string): string {
  return new URL(`${stamp}.gkg.csv.zip`, current.url).toString();
}

// GDELT ships one deflated CSV per window inside a zip. A dependency rather than
// a hand-rolled reader over `zlib.inflateRaw`: the container has data descriptors
// and zip64 to get right, this is a free public service whose output we do not
// control, and fflate is a pinned zero-dependency library — the same reasoning
// that put fast-xml-parser behind the RSS parser.
export function readGkgArchive(archive: Uint8Array): string {
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error(`GKG archive is ${archive.length} bytes, over the ${MAX_ARCHIVE_BYTES}-byte ceiling`);
  }
  let csvName: string | null = null;
  const entries = unzipSync(archive, {
    filter: (entry) => {
      if (!entry.name.toLowerCase().endsWith(".csv")) return false;
      if (csvName !== null) throw new Error("GKG archive holds more than one .csv entry");
      if (entry.originalSize > MAX_CSV_BYTES) {
        throw new Error(`GKG CSV is ${entry.originalSize} uncompressed bytes, over the ${MAX_CSV_BYTES}-byte ceiling`);
      }
      csvName = entry.name;
      return true;
    },
  });
  if (csvName === null) throw new Error("GKG archive holds no .csv entry");
  const csv = entries[csvName];
  if (csv.length > MAX_CSV_BYTES) {
    throw new Error(`GKG CSV is ${csv.length} extracted bytes, over the ${MAX_CSV_BYTES}-byte ceiling`);
  }
  return Buffer.from(csv).toString("utf-8");
}

function textOf(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

// GDELT stamps are YYYYMMDDHHMMSS in UTC. Date.UTC rolls impossible dates
// forward, so every component is round-tripped before the value is accepted.
// Exported because the DOC API stamps `seendate` in the same 14 UTC digits (#46) —
// one reading of GDELT's clock rather than two that could disagree.
export function parseGdeltStamp(value: string | null): Date | null {
  const digits = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value ?? "");
  if (!digits) return null;
  const [, year, month, day, hour, minute, second] = digits.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second
    ? parsed
    : null;
}

// V2EXTRASXML is XML-shaped but not well-formed — real titles carry a bare `&` —
// so it is read tag by tag rather than parsed.
function extraTag(extras: string | null, tag: string): string | null {
  if (!extras) return null;
  return textOf(new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(extras)?.[1]);
}

function averageTone(value: string | undefined): number | null {
  const average = Number.parseFloat(textOf(value)?.split(",")[0] ?? "");
  return Number.isFinite(average) ? average : null;
}

// `charOffset` is an int4 column. Digits only — `Number("")` is 0, so a
// `Name,`-shaped entry would otherwise be accepted as an occurrence at offset 0.
function charOffsetOf(value: string | undefined): number | null {
  const digits = (value ?? "").trim();
  return /^\d{1,9}$/.test(digits) ? Number(digits) : null;
}

function surfaceNameOf(value: string | undefined): string | null {
  // Preserve the surface name byte-for-byte after splitting off GKG's structural
  // comma. Resolution needs the reported form; trim only to decide whether the
  // field carries a name at all.
  const name = value ?? "";
  return name.trim() === "" ? null : name;
}

// V2ENHANCEDPERSONS, V2ENHANCEDORGANIZATIONS and V2ENHANCEDTHEMES all share one
// shape: `;`-separated occurrences of `Name,charOffset`. Split at the *last*
// comma, because GDELT does not escape commas inside a name.
function parseNameAnnotations(field: string | undefined, kind: GkgAnnotationKind): ParsedAnnotation[] {
  return (field ?? "").split(";").flatMap((entry) => {
    const comma = entry.lastIndexOf(",");
    if (comma < 0) return [];
    const surfaceName = surfaceNameOf(entry.slice(0, comma));
    const charOffset = charOffsetOf(entry.slice(comma + 1));
    return surfaceName === null || charOffset === null
      ? []
      : [{ kind, surfaceName, charOffset, locationDetail: null }];
  });
}

// V2ENHANCEDLOCATIONS uses `#` between components precisely because a location's
// full name contains commas ("Chennai, Tamil Nadu, India"). Nine components:
// type, full name, country code, ADM1, ADM2, latitude, longitude, FeatureID,
// character offset — and a wrong count means the entry cannot be read
// positionally, exactly as for a row.
const LOCATION_PARTS = 9;
const LOCATION = { name: 1, countryCode: 2, latitude: 5, longitude: 6, featureId: 7, charOffset: 8 } as const;

function coordinate(value: string | undefined, limit: number): number | null | undefined {
  const text = textOf(value);
  // Empty is honest absence: GKG reports no coordinates for a location it could
  // not place. `undefined` means present but unreadable, which the caller drops —
  // storing garbage as null would make it indistinguishable from absence.
  if (text === null) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : undefined;
}

function parseLocationAnnotations(field: string | undefined): ParsedAnnotation[] {
  return (field ?? "").split(";").flatMap((entry) => {
    const parts = entry.split("#");
    if (parts.length !== LOCATION_PARTS) return [];
    const surfaceName = surfaceNameOf(parts[LOCATION.name]);
    const charOffset = charOffsetOf(parts[LOCATION.charOffset]);
    const latitude = coordinate(parts[LOCATION.latitude], 90);
    const longitude = coordinate(parts[LOCATION.longitude], 180);
    if (surfaceName === null || charOffset === null || latitude === undefined || longitude === undefined) return [];
    return [
      {
        kind: "location" as const,
        surfaceName,
        charOffset,
        locationDetail: {
          // A FeatureID is a GNS/GNIS number for a place and a country code for a
          // whole country, so it stays a string. ADM1/ADM2 are dropped: nothing
          // in ADR-0019 resolves on them.
          featureId: textOf(parts[LOCATION.featureId]),
          countryCode: textOf(parts[LOCATION.countryCode]),
          latitude,
          longitude,
        },
      },
    ];
  });
}

function parseAnnotations(fields: string[]): ParsedAnnotation[] {
  return [
    ...parseNameAnnotations(fields[FIELD.persons], "person"),
    ...parseNameAnnotations(fields[FIELD.organizations], "organization"),
    ...parseNameAnnotations(fields[FIELD.themes], "theme"),
    ...parseLocationAnnotations(fields[FIELD.locations]),
  ];
}

function toGkgRow(fields: string[]): GkgRow {
  // A row that is not exactly 27 fields cannot be read positionally at all — a
  // truncated record has no V2EXTRASXML, and an extra tab shifts every index, so
  // reading on would key an Article on whatever now sits at field 5. Nulls
  // throughout make it a failed item, which is the honest outcome.
  if (fields.length !== FIELD_COUNT) {
    return {
      recordId: textOf(fields[FIELD.recordId]),
      sourceDomain: null,
      documentIdentifier: null,
      title: null,
      publishedAt: null,
      tone: null,
      annotations: [],
    };
  }
  const extras = textOf(fields[FIELD.extrasXml]);
  const title = extraTag(extras, "PAGE_TITLE");
  return {
    recordId: textOf(fields[FIELD.recordId]),
    sourceDomain: textOf(fields[FIELD.sourceDomain])?.toLowerCase() ?? null,
    documentIdentifier: textOf(fields[FIELD.documentIdentifier]),
    title: title === null ? null : decodeEntities(title),
    // PAGE_PRECISEPUBTIMESTAMP is the publisher's own timestamp and is present in
    // roughly 60% of rows; V2.1DATE (when GDELT saw the document) is the fallback.
    // The window stamp is the weaker of the two — ADR-0020's timeline orders by
    // publishedAt — so the publisher's own value is preferred where it exists.
    publishedAt: parseGdeltStamp(extraTag(extras, "PAGE_PRECISEPUBTIMESTAMP")) ?? parseGdeltStamp(textOf(fields[FIELD.date])),
    tone: averageTone(fields[FIELD.tone]),
    annotations: parseAnnotations(fields),
  };
}

// Every non-empty line yields a row, including a mutilated one: a row missing its
// title or URL comes back with nulls so the caller fails *that item* and counts
// it, exactly as it does for a malformed feed entry. Only a body that is not a
// GKG file at all — an HTML error page from the CDN, say — fails the whole run.
//
// ponytail: the window is split in memory (a ~9 MB file, ~3 MB over the wire), so
// GCAM is briefly resident before being dropped. Streaming line by line is the
// upgrade path if window size grows; ADR-0024 measured 656 rows/8.26 MB.
export function parseGkgCsv(csv: string): GkgRow[] {
  const rows = csv
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.split("\t"));
  if (!rows.some((fields) => fields.length === FIELD_COUNT)) {
    throw new Error(`Not a GKG 2.1 CSV: no row carries ${FIELD_COUNT} tab-separated fields`);
  }
  return rows.map(toGkgRow);
}
