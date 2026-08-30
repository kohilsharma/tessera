import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseGkgCsv, readGkgArchive, resolveGkgWindowUrl } from "../src/ingestion/gkg";
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

describe("readGkgArchive", () => {
  it("returns the single CSV entry GDELT ships per window", async () => {
    const csv = await windowCsv();

    expect(readGkgArchive(zipSync({ "20260830190000.gkg.csv": strToU8(csv) }))).toBe(csv);
  });

  it("throws when the archive carries no CSV", () => {
    expect(() => readGkgArchive(zipSync({ "readme.txt": strToU8("not a window") }))).toThrow(/no \.csv entry/);
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
