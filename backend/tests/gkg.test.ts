import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { GkgAnnotationKind } from "../src/entities/GkgAnnotation";
import { parseGkgCsv, planGkgCatchUp, readGkgArchive, resolveGkgWindowUrl, gkgWindowUrl, type GkgRow } from "../src/ingestion/gkg";
import { httpFetchBytes, httpFetchText } from "../src/ingestion/runConnector";

// No database here: the GKG parser is pure, so its tests need neither a container
// nor a migration. The connector's *effects* on Articles are covered in
// ingestion.test.ts, at the runConnector seam.

// The committed slice is four untouched rows of the live window
// `20260830190000` — real GCAM, real `V2EXTRASXML`, real entity escaping, and one
// title carrying both `&#x2013;` and a bare `&`, which is why EXTRASXML cannot be
// handed to an XML parser.
const windowCsv = () => readFile(join(__dirname, "fixtures", "gkg", "20260830190000.gkg.csv"), "utf-8");
const malformedCsv = () =>
  readFile(join(__dirname, "fixtures", "gkg", "20260830190000-malformed.gkg.csv"), "utf-8");

// The real body of http://data.gdeltproject.org/gdeltv2/lastupdate.txt, captured
// 2026-08-30: three `size md5 url` lines, of which only the third is GKG.
const GKG_ENDPOINT = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";

const LAST_UPDATE = [
  "32240 6b9e0f61d4ec8844dc9c2d997c4c8fc5 http://data.gdeltproject.org/gdeltv2/20260830190000.export.CSV.zip",
  "70091 d1a3f2a118ad972e3e1a9ef0aeb6a4df http://data.gdeltproject.org/gdeltv2/20260830190000.mentions.CSV.zip",
  "3066848 98f668dc83aa84d1942c973fc5fcf07c http://data.gdeltproject.org/gdeltv2/20260830190000.gkg.csv.zip",
].join("\n");

describe("resolveGkgWindowUrl", () => {
  it("takes the GKG file and its 15-minute window stamp, ignoring the event tables", () => {
    expect(resolveGkgWindowUrl(LAST_UPDATE, GKG_ENDPOINT)).toEqual({
      url: "http://data.gdeltproject.org/gdeltv2/20260830190000.gkg.csv.zip",
      stamp: "20260830190000",
    });
  });

  it("throws when the body names no GKG file", () => {
    expect(() => resolveGkgWindowUrl("<html>503 Service Unavailable</html>", GKG_ENDPOINT)).toThrow(
      /no \.gkg\.csv\.zip/,
    );
  });

  // The names come out of an unauthenticated response body and decide what gets
  // downloaded next, so a body pointing anywhere but the connector's own host is
  // refused rather than fetched.
  it("refuses a file named off the connector's own host", () => {
    const hostile = "12 abc http://169.254.169.254/latest/20260830190000.gkg.csv.zip";

    expect(() => resolveGkgWindowUrl(hostile, GKG_ENDPOINT)).toThrow(/off the connector's own host/);
  });
});

// #45. The worker is not a 24/7 service, so a gap in the firehose is normal.
// `lastupdate.txt` names only the current window, and `masterfilelist.txt` is
// 127 MB — so the missed windows are named arithmetically off GDELT's own
// 15-minute grid instead.
describe("planGkgCatchUp", () => {
  const CURRENT = "20260830190000";

  it("reads only the current window when the cursor is the window before it", () => {
    expect(planGkgCatchUp("20260830184500", CURRENT)).toEqual({ stamps: [CURRENT], skippedWindows: 0 });
  });

  it("reads nothing when the cursor already names the current window", () => {
    // GDELT has published nothing since, so there is no file worth downloading —
    // re-reading would be idempotent but still 3 MB over the wire.
    expect(planGkgCatchUp(CURRENT, CURRENT)).toEqual({ stamps: [], skippedWindows: 0 });
    // A cursor *ahead* of the current window (a clock correction upstream) is the
    // same answer rather than arithmetic run backwards.
    expect(planGkgCatchUp("20260830191500", CURRENT)).toEqual({ stamps: [], skippedWindows: 0 });
  });

  it("names every missed window between the cursor and now, oldest first", () => {
    // An hour off, crossing the hour boundary — the case a plain `+15` on the
    // minute field gets wrong.
    expect(planGkgCatchUp("20260830180000", CURRENT).stamps).toEqual([
      "20260830181500",
      "20260830183000",
      "20260830184500",
      CURRENT,
    ]);
    // ...and across midnight, where the date has to roll too.
    expect(planGkgCatchUp("20260830233000", "20260831001500").stamps).toEqual([
      "20260830234500",
      "20260831000000",
      "20260831001500",
    ]);
  });

  it("heals a gap at the cap and skips one past it, saying how much it dropped", () => {
    // Eight missed windows is two hours: the last gap that is healed rather than
    // skipped, and nine files to read counting the current one.
    const atCap = planGkgCatchUp("20260830164500", CURRENT);
    expect(atCap.stamps).toHaveLength(9);
    expect(atCap.stamps.at(0)).toBe("20260830170000");
    expect(atCap.stamps.at(-1)).toBe(CURRENT);
    expect(atCap.skippedWindows).toBe(0);

    // One window further back and the backfill is refused outright rather than
    // trimmed: the run goes live and reports what it passed over.
    expect(planGkgCatchUp("20260830163000", CURRENT)).toEqual({ stamps: [CURRENT], skippedWindows: 9 });
    // A machine off for a week does not attempt 672 downloads.
    expect(planGkgCatchUp("20260823190000", CURRENT)).toEqual({ stamps: [CURRENT], skippedWindows: 671 });
  });

  it("goes live with no cursor at all, and treats an unreadable one the same way", () => {
    expect(planGkgCatchUp(null, CURRENT)).toEqual({ stamps: [CURRENT], skippedWindows: 0 });
    // An RSS `lastBuildDate` in the cursor column would be a mis-seeded
    // connector; going live beats generating file names out of it.
    expect(planGkgCatchUp("Sat, 30 Aug 2026 19:00:00 GMT", CURRENT)).toEqual({
      stamps: [CURRENT],
      skippedWindows: 0,
    });
  });

  it("snaps an off-grid cursor onto GDELT's own quarter-hour boundaries", () => {
    // Nothing should write such a cursor, but the value decides which file names
    // are requested — off-grid arithmetic would ask for windows GDELT never
    // published.
    expect(planGkgCatchUp("20260830183712", CURRENT).stamps).toEqual(["20260830184500", CURRENT]);
  });
});

describe("gkgWindowUrl", () => {
  it("names a missed window beside the file GDELT itself named", () => {
    const current = resolveGkgWindowUrl(LAST_UPDATE, GKG_ENDPOINT);

    expect(gkgWindowUrl(current, "20260830184500")).toBe(
      "http://data.gdeltproject.org/gdeltv2/20260830184500.gkg.csv.zip",
    );
  });
});

describe("readGkgArchive", () => {
  it("returns the single CSV entry GDELT ships per window", async () => {
    const csv = await windowCsv();

    expect(readGkgArchive(zipSync({ "20260830190000.gkg.csv": strToU8(csv) }))).toBe(csv);
  });

  it("throws when the archive carries no CSV", () => {
    expect(() => readGkgArchive(zipSync({ "readme.txt": strToU8("not a window") }))).toThrow(/no \.csv entry/);
  });

  it("refuses a CSV whose declared or extracted size exceeds the window ceiling", () => {
    const declaredOversized = zipSync({ "20260830190000.gkg.csv": strToU8("one row") });
    const declaredCentralDirectory = declaredOversized.findIndex(
      (byte, index) =>
        byte === 0x50 &&
        declaredOversized[index + 1] === 0x4b &&
        declaredOversized[index + 2] === 0x01 &&
        declaredOversized[index + 3] === 0x02,
    );
    // ZIP central-directory offset 24 is the declared uncompressed size. Mutating
    // metadata exercises the pre-inflation guard without allocating a huge fixture.
    new DataView(declaredOversized.buffer, declaredOversized.byteOffset, declaredOversized.byteLength).setUint32(
      declaredCentralDirectory + 24,
      32 * 1024 * 1024 + 1,
      true,
    );
    expect(() => readGkgArchive(declaredOversized)).toThrow(/uncompressed.*ceiling/);

    // A stored entry can lie in the other direction. The post-extraction check
    // must use actual bytes rather than trusting the central directory alone.
    const extractedOversized = zipSync(
      { "20260830190000.gkg.csv": new Uint8Array(32 * 1024 * 1024 + 1) },
      { level: 0 },
    );
    const extractedCentralDirectory = extractedOversized.findIndex(
      (byte, index) =>
        byte === 0x50 &&
        extractedOversized[index + 1] === 0x4b &&
        extractedOversized[index + 2] === 0x01 &&
        extractedOversized[index + 3] === 0x02,
    );
    new DataView(extractedOversized.buffer, extractedOversized.byteOffset, extractedOversized.byteLength).setUint32(
      extractedCentralDirectory + 24,
      1,
      true,
    );
    expect(() => readGkgArchive(extractedOversized)).toThrow(/extracted.*ceiling/);
  });
});

describe("parseGkgCsv", () => {
  it("reads a real window slice into Articles-to-be, dropping GCAM entirely", async () => {
    const rows = parseGkgCsv(await windowCsv());

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.documentIdentifier)).toEqual([
      "https://www.wmuk.org/npr-news/2026-08-30/canada-claps-back-at-trumps-efforts-to-rename-lake-ontario-as-lake-america",
      "https://www.thehindu.com/news/cities/chennai/the-hindu-in-school-educators-confluence-2026-to-be-held-on-sept-2/article71408318.ece",
      "https://timesofindia.indiatimes.com/city/guwahati/manipur-cm-khemchand-urges-people-to-avoid-bandhs-amid-nrc-demand/articleshow/133635705.cms",
      "https://kdwa.com/karen-sue-patterson/",
    ]);
    expect(rows.map((row) => row.sourceDomain)).toEqual(["wmuk.org", "thehindu.com", "indiatimes.com", "kdwa.com"]);
    expect(rows[0].title).toBe("Canada claps back at Trump's efforts to rename Lake Ontario as 'Lake America'");
    // Entity-decoded (`&#x2013;` is an en dash) while the bare `&` the publisher
    // left unescaped survives — the reason this field is read tag by tag rather
    // than parsed as XML.
    expect(rows[3].title).toBe("KAREN SUE PATTERSON – KDWA 1460 AM & FM 97.7");
    // GCAM is 71.5% of a window's bytes (ADR-0024) and never leaves the parser:
    // every GCAM field in the slice starts with its word-count key.
    expect(JSON.stringify(rows)).not.toContain("wc:");
  });

  it("prefers the publisher's own timestamp and falls back to the window's", async () => {
    const rows = parseGkgCsv(await windowCsv());

    // PAGE_PRECISEPUBTIMESTAMP, present on the first two rows.
    expect(rows[0].publishedAt).toEqual(new Date("2026-08-30T10:36:00Z"));
    expect(rows[1].publishedAt).toEqual(new Date("2026-08-30T18:27:00Z"));
    // The last two rows carry none, so V2.1DATE — when GDELT saw them — stands in.
    expect(rows[2].publishedAt).toEqual(new Date("2026-08-30T19:00:00Z"));
    expect(rows[3].publishedAt).toEqual(new Date("2026-08-30T19:00:00Z"));
  });

  it("rejects an impossible calendar date instead of letting JavaScript roll it forward", async () => {
    const fields = (await windowCsv()).split("\n")[2].split("\t");
    fields[1] = "20260230000000";

    expect(parseGkgCsv(fields.join("\t"))[0].publishedAt).toBeNull();
  });

  it("keeps average tone, the one V1.5Tone component the timeline wants", async () => {
    const rows = parseGkgCsv(await windowCsv());

    // First component of the tuple, signed — not the word count that ends it.
    expect(rows[0].tone).toBeCloseTo(-0.884955752212389, 10);
    expect(rows[1].tone).toBeCloseTo(3.7914691943128, 10);
    expect(rows.every((row) => row.tone !== null && Math.abs(row.tone) < 100)).toBe(true);
  });

  it("returns a row per line even when a row is mutilated, so the caller can fail just that item", async () => {
    const rows = parseGkgCsv(await malformedCsv());

    expect(rows).toHaveLength(3);
    expect(rows[0].title).not.toBeNull();
    expect(rows[0].documentIdentifier).not.toBeNull();
    // Truncated after six fields: no V2EXTRASXML, so no title.
    expect(rows[1].title).toBeNull();
    // ...and nothing positional at all, so no annotations either.
    expect(rows[1].annotations).toEqual([]);
    // Intact but for an empty document identifier.
    expect(rows[2].title).not.toBeNull();
    expect(rows[2].documentIdentifier).toBeNull();
  });

  // A row is read positionally, so a stray tab shifts every field: field 5 would
  // hand back something that is not the document's URL. Refused as a whole.
  it("reads nothing positionally out of a row whose field count is wrong", async () => {
    const [line] = (await windowCsv()).split("\n");
    const extraTab = line.replace("\t", "\t\t");

    const [row] = parseGkgCsv(`${extraTab}\n${line}`);

    expect(row.documentIdentifier).toBeNull();
    expect(row.title).toBeNull();
    expect(row.publishedAt).toBeNull();
    expect(row.annotations).toEqual([]);
  });

  // A publisher's own <title> reaches us through GDELT unaltered, so a mangled
  // numeric entity is untrusted input. It must not throw: parsing happens above
  // the per-item loop, and a RangeError there would discard the whole window.
  it("leaves an unstorable numeric entity as written rather than throwing", async () => {
    const [line] = (await windowCsv()).split("\n");
    const mangled = line.replace(/<PAGE_TITLE>[^<]*<\/PAGE_TITLE>/, "<PAGE_TITLE>A &#1114112; B &#0; C</PAGE_TITLE>");

    const [row] = parseGkgCsv(mangled);

    expect(row.title).toBe("A &#1114112; B &#0; C");
  });

  it("throws when the body is not a GKG window at all", () => {
    expect(() => parseGkgCsv("<html><body>503 from the CDN</body></html>")).toThrow(/Not a GKG 2\.1 CSV/);
  });
});

// #43. CONTEXT.md "GKG Annotation": the persons, organizations, locations and
// themes GDELT already extracted, as surface-name occurrences, before any
// resolution. Read out of the *enhanced* fields (12, 14, 8, 10) rather than their
// V1 twins, because only those carry the character offset that makes an
// occurrence distinct — and a co-occurrence self-join meaningful (ADR-0019).
describe("GKG Annotations", () => {
  const kindOf = (row: GkgRow, kind: GkgAnnotationKind) =>
    row.annotations.filter((annotation) => annotation.kind === kind);

  it("reads every occurrence of all four kinds, with the names and offsets GKG reported", async () => {
    const rows = parseGkgCsv(await windowCsv());

    // Both offsets for a repeated name, in GDELT's own order: the same person
    // named twice in one document is two occurrences, not one.
    expect(kindOf(rows[0], "person")).toEqual([
      { kind: "person", surfaceName: "Mark Carney", charOffset: 709, locationDetail: null },
      { kind: "person", surfaceName: "Mark Carney", charOffset: 2059, locationDetail: null },
      { kind: "person", surfaceName: "Doug Ford", charOffset: 25, locationDetail: null },
      { kind: "person", surfaceName: "Doug Ford", charOffset: 513, locationDetail: null },
      { kind: "person", surfaceName: "Doug Ford", charOffset: 1643, locationDetail: null },
      { kind: "person", surfaceName: "Keito Newman", charOffset: 1775, locationDetail: null },
      { kind: "person", surfaceName: "Kathy Hochul", charOffset: 3553, locationDetail: null },
    ]);
    // Surface names exactly as GKG reported them: GDELT's own title-casing on an
    // organization it recognised, its uppercase taxonomy label on a theme.
    // Nothing is folded, decoded or resolved here — Phase 3.5 resolves canonical
    // Entities *from* these strings.
    expect(kindOf(rows[1], "organization")).toContainEqual({
      kind: "organization",
      surfaceName: "Head Of The Department Of Psychiatry",
      charOffset: 609,
      locationDetail: null,
    });
    expect(kindOf(rows[0], "theme")[0]).toEqual({
      kind: "theme",
      surfaceName: "MEDIA_SOCIAL",
      charOffset: 2585,
      locationDetail: null,
    });
    // The whole slice, kind by kind — a change in any field index shows up here.
    expect(rows.map((row) => row.annotations.length)).toEqual([147, 41, 66, 19]);
    expect(rows.map((row) => kindOf(row, "person").length)).toEqual([7, 2, 1, 1]);
    expect(rows.map((row) => kindOf(row, "organization").length)).toEqual([8, 6, 2, 3]);
    expect(rows.map((row) => kindOf(row, "location").length)).toEqual([59, 1, 24, 5]);
  });

  it("keeps a location's FeatureID, coordinates and country, and nothing else's", async () => {
    const rows = parseGkgCsv(await windowCsv());

    // A location's full name is comma-bearing, which is why the enhanced location
    // field is `#`-separated and read differently from the other three.
    expect(kindOf(rows[1], "location")).toEqual([
      {
        kind: "location",
        surfaceName: "Chennai, Tamil Nadu, India",
        charOffset: 85,
        locationDetail: { featureId: "-2103041", countryCode: "IN", latitude: 13.0833, longitude: 80.2833 },
      },
    ]);
    // A whole country's FeatureID is its country code rather than a GNS number,
    // which is why the field stays a string.
    expect(kindOf(rows[0], "location")[0].locationDetail).toEqual({
      featureId: "US",
      countryCode: "US",
      latitude: 39.828175,
      longitude: -98.5795,
    });
    // GKG reports no gazetteer detail for the other three kinds, so they carry
    // none rather than an empty object.
    expect(
      rows.every((row) =>
        row.annotations.every(
          (annotation) => (annotation.kind === "location") === (annotation.locationDetail !== null),
        ),
      ),
    ).toBe(true);
  });

  // Every one of these fields reaches us through GDELT from a publisher's page,
  // so they are untrusted input on the way into the database.
  it("preserves usable surface names exactly and drops occurrences with invalid offsets", async () => {
    const fields = (await windowCsv()).split("\n")[0].split("\t");
    fields[12] = `  Real Person  ,42;No Offset;Bad Offset,x;,77;Trailing Comma,;Negative,-3`;
    fields[14] = `${"A".repeat(513)},5`;
    // The first entry is short of the nine `#`-separated components, so it cannot
    // be read positionally — the same rule the row itself follows.
    fields[10] = `4#Too Few#IN#IN25#13#80;4#Chennai, Tamil Nadu, India#IN#IN25#70251#13.0833#80.2833#-2103041#85`;

    const [row] = parseGkgCsv(fields.join("\t"));

    expect(kindOf(row, "person")).toEqual([
      { kind: "person", surfaceName: "  Real Person  ", charOffset: 42, locationDetail: null },
    ]);
    expect(kindOf(row, "organization")).toEqual([
      { kind: "organization", surfaceName: "A".repeat(513), charOffset: 5, locationDetail: null },
    ]);
    expect(kindOf(row, "location").map((annotation) => annotation.charOffset)).toEqual([85]);
  });

  // Absence and garbage must not arrive looking the same: a null latitude has to
  // mean GKG placed none, or the Phase-3.5 map cannot tell an unplaceable
  // location from a mangled one.
  it("keeps a location GKG gave no coordinates for and drops one whose coordinates are garbage", async () => {
    const fields = (await windowCsv()).split("\n")[0].split("\t");
    fields[10] = [
      `1#Unplaced#IN#IN##  #  #IN#10`,
      `4#Off The Globe, India#IN#IN25#70251#913.0833#80.2833#-2103041#20`,
      `4#Not A Number, India#IN#IN25#70251#13.0833#east#-2103041#30`,
      `4#Numeric Prefix, India#IN#IN25#70251#13.0833north#80.2833#-2103041#40`,
      `4#Hex Syntax, India#IN#IN25#70251#0x10#80.2833#-2103041#50`,
    ].join(";");

    const [row] = parseGkgCsv(fields.join("\t"));

    expect(kindOf(row, "location")).toEqual([
      {
        kind: "location",
        surfaceName: "Unplaced",
        charOffset: 10,
        locationDetail: { featureId: "IN", countryCode: "IN", latitude: null, longitude: null },
      },
    ]);
  });
});

// Opt-in: `GDELT_LIVE_SMOKE=1 npm test` reaches the real firehose, which is how a
// change in GDELT's shape gets noticed. Skipped by default so the suite stays
// offline and CI never depends on a free public service being up.
describe.runIf(process.env.GDELT_LIVE_SMOKE === "1")("GDELT live smoke", () => {
  it("resolves, downloads, unzips and parses the current window", async () => {
    const window = resolveGkgWindowUrl(await httpFetchText(GKG_ENDPOINT), GKG_ENDPOINT);
    const rows = parseGkgCsv(readGkgArchive(await httpFetchBytes(window.url)));

    expect(rows.length).toBeGreaterThan(50);
    // The two fields the connector cannot do without. GDELT's own numbers put
    // PAGE_TITLE in every row of an observed window; a majority is the assertion
    // that survives a bad day upstream while still failing on a shape change.
    expect(rows.filter((row) => row.title && row.documentIdentifier).length).toBeGreaterThan(rows.length / 2);
    expect(rows.every((row) => row.publishedAt !== null)).toBe(true);
  }, 180_000);
});
