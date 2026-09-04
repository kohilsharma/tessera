import { describe, expect, it } from "vitest";
import { PUBLISHER_LEANINGS } from "../src/entities/Publisher";
import { ALLSIDES_RATED_DOMAINS, LEANING_SOURCES, leaningFor, toPublicLeaning } from "../src/lib/publisherLeaning";

// CONTEXT.md "Publisher Leaning": a rating is a *cited claim about a publisher*,
// never Tessera's own inference. These are the two functions that decide what a
// rating is and whether it may be shown at all, so the invariant is tested here
// rather than trusted to the pages that render it.
describe("leaningFor", () => {
  it("rates a domain AllSides has rated", () => {
    expect(leaningFor("apnews.com")).toEqual({ leaning: "lean_left", leaningSource: "allsides" });
    expect(leaningFor("foxnews.com")).toEqual({ leaning: "right", leaningSource: "allsides" });
  });

  it("carries a rating down to the newsroom's own section hosts", () => {
    // The firehose reports `edition.cnn.com` and `www.bbc.co.uk`; both are the
    // newsroom AllSides rated, and a rating that only matched the apex would
    // leave most of the live corpus unrated for a hosting convention.
    expect(leaningFor("edition.cnn.com")?.leaning).toBe("lean_left");
    expect(leaningFor("www.bbc.co.uk")?.leaning).toBe("center");
  });

  it("matches on the dot boundary, never a bare suffix", () => {
    // `notfoxnews.com` is a different publisher that happens to end in the same
    // letters. Putting AllSides' Fox News rating on it would be a fabricated
    // claim about a real outlet.
    expect(leaningFor("notfoxnews.com")).toBeNull();
  });

  it("states nothing for a publisher AllSides has not rated", () => {
    // The honest answer, and the common one: AllSides rates national political
    // outlets, so most of what ingestion discovers has no published rating.
    expect(leaningFor("krebsonsecurity.com")).toBeNull();
    expect(leaningFor("meridianwire.example")).toBeNull();
  });

  it("holds only normalized, unique domains carrying a rating in the vocabulary", () => {
    const domains = Object.keys(ALLSIDES_RATED_DOMAINS);
    expect(new Set(domains).size).toBe(domains.length);
    for (const [domain, leaning] of Object.entries(ALLSIDES_RATED_DOMAINS)) {
      // `publisherDomain()` lowercases and strips `www.`, so a key it can never
      // produce is a key that would never match a Publisher row.
      expect(domain).toBe(domain.toLowerCase());
      expect(domain.startsWith("www.")).toBe(false);
      expect(PUBLISHER_LEANINGS).toContain(leaning);
    }
  });
});

describe("toPublicLeaning", () => {
  it("collapses all five ratings onto the three-token spectrum axis", () => {
    const band = (leaning: (typeof PUBLISHER_LEANINGS)[number]) =>
      toPublicLeaning({ leaning, leaningSource: "allsides" })?.band;
    expect(PUBLISHER_LEANINGS.map(band)).toEqual(["left", "left", "centre", "right", "right"]);
  });

  it("never serves a rating without the source that published it", () => {
    const shown = toPublicLeaning({ leaning: "lean_left", leaningSource: "allsides" });
    expect(shown).toEqual({
      rating: "lean_left",
      // AllSides' own wording for the rating, not ours.
      label: "Lean Left",
      // Collapsed onto DESIGN.md's three-way axis once, here, so the mark and
      // #86's spectrum can never disagree about which side a rating counts on.
      band: "left",
      source: LEANING_SOURCES.allsides,
    });
    expect(shown?.source.name).toBe("AllSides");
    expect(shown?.source.licence).toContain("CC BY-NC");
    expect(shown?.source.url).toMatch(/^https:\/\/www\.allsides\.com\//);
  });

  it("says nothing at all for an unrated Publisher", () => {
    expect(toPublicLeaning({ leaning: null, leaningSource: null })).toBeNull();
  });

  it("refuses a rating whose credit is missing or unrecognised", () => {
    // Both columns are varchar, so a hand-edited row can hold either half alone.
    // Showing the rating anyway would put an uncredited verdict about a real
    // publisher on the page; the honest fallback is "unrated".
    expect(toPublicLeaning({ leaning: "right", leaningSource: null })).toBeNull();
    expect(toPublicLeaning({ leaning: null, leaningSource: "allsides" })).toBeNull();
    expect(toPublicLeaning({ leaning: "right", leaningSource: "some-blog" })).toBeNull();
    expect(toPublicLeaning({ leaning: "hard-left" as never, leaningSource: "allsides" })).toBeNull();
  });
});
