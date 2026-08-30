import { unzipSync } from "fflate";
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
  documentIdentifier: 4, // V2DocumentIdentifier — the article URL
  tone: 15, // V1.5Tone — a comma-separated tuple whose first value is average tone
  extrasXml: 26, // V2EXTRASXML — where PAGE_TITLE lives
} as const;

export type GkgRow = {
  recordId: string | null;
  // Raw, not canonicalized: normalization belongs to the run, so a URL is
  // canonicalized in exactly one place (same split as rss.ts).
  documentIdentifier: string | null;
  title: string | null;
  publishedAt: Date | null;
  // Average document tone. Retained for the Phase-3.5 timeline overlay
  // (ADR-0020, ADR-0024); nothing reads it yet.
  tone: number | null;
};

export type GkgWindow = { url: string; stamp: string };

// A window is ~3 MB compressed / ~9 MB raw (ADR-0024 measured 8.26 MB), and the
// demo box has ~3 GB free (ADR-0023) — so an archive far outside that shape is
// refused rather than inflated into memory.
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

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

// GDELT ships one deflated CSV per window inside a zip. A dependency rather than
// a hand-rolled reader over `zlib.inflateRaw`: the container has data descriptors
// and zip64 to get right, this is a free public service whose output we do not
// control, and fflate is a pinned zero-dependency library — the same reasoning
// that put fast-xml-parser behind the RSS parser.
export function readGkgArchive(archive: Uint8Array): string {
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error(`GKG archive is ${archive.length} bytes, over the ${MAX_ARCHIVE_BYTES}-byte ceiling`);
  }
  const entries = unzipSync(archive);
  const name = Object.keys(entries).find((entry) => entry.toLowerCase().endsWith(".csv"));
  if (!name) throw new Error(`GKG archive holds no .csv entry (holds: ${Object.keys(entries).join(", ") || "nothing"})`);
  return Buffer.from(entries[name]).toString("utf-8");
}

function textOf(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

// GDELT stamps are YYYYMMDDHHMMSS in UTC. Reassembled into an ISO string rather
// than fed to Date.UTC, because ISO parsing rejects an impossible date instead of
// rolling it over into a plausible-looking wrong one.
function parseStamp(value: string | null): Date | null {
  const digits = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value ?? "");
  if (!digits) return null;
  const [, year, month, day, hour, minute, second] = digits;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function toGkgRow(fields: string[]): GkgRow {
  // A row that is not exactly 27 fields cannot be read positionally at all — a
  // truncated record has no V2EXTRASXML, and an extra tab shifts every index, so
  // reading on would key an Article on whatever now sits at field 5. Nulls
  // throughout make it a failed item, which is the honest outcome.
  if (fields.length !== FIELD_COUNT) {
    return { recordId: textOf(fields[FIELD.recordId]), documentIdentifier: null, title: null, publishedAt: null, tone: null };
  }
  const extras = textOf(fields[FIELD.extrasXml]);
  const title = extraTag(extras, "PAGE_TITLE");
  return {
    recordId: textOf(fields[FIELD.recordId]),
    documentIdentifier: textOf(fields[FIELD.documentIdentifier]),
    title: title === null ? null : decodeEntities(title),
    // PAGE_PRECISEPUBTIMESTAMP is the publisher's own timestamp and is present in
    // roughly 60% of rows; V2.1DATE (when GDELT saw the document) is the fallback.
    // The window stamp is the weaker of the two — ADR-0020's timeline orders by
    // publishedAt — so the publisher's own value is preferred where it exists.
    publishedAt: parseStamp(extraTag(extras, "PAGE_PRECISEPUBTIMESTAMP")) ?? parseStamp(textOf(fields[FIELD.date])),
    tone: averageTone(fields[FIELD.tone]),
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
