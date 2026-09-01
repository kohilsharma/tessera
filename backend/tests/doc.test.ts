import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DOC_MAX_RECORDS, docRequestUrl, parseDocArtList } from "../src/ingestion/doc";
import { httpFetchDocText } from "../src/ingestion/runConnector";
import { SEED_CONNECTORS } from "../src/seedData/corpus";

// No database here: the DOC parser is pure, so its tests need neither a container
// nor a migration. The connector's *effects* on Articles are covered in
// ingestion.test.ts, at the runConnector seam — the same split as gkg.test.ts.

// Two untouched captures of the live API (2026-08-31). The five-record one happens
// to carry the awkward cases real data always does: the same article twice, once
// with a `?source=` referrer tag, and that same headline again under a second
// masthead. The other is a full 250-record response, which is the only way to
// exercise the cap.
const artlist = () => readFile(join(__dirname, "fixtures", "doc", "artlist.json"), "utf-8");
const cappedArtlist = () => readFile(join(__dirname, "fixtures", "doc", "artlist-capped.json"), "utf-8");

// The seeded connector's own endpoint, so a drift between what the seed configures
// and what this proves about is not possible.
const DOC_ENDPOINT = SEED_CONNECTORS.find((connector) => connector.kind === "gdelt_doc")!.endpoint;

describe("docRequestUrl", () => {
  it("keeps what the operator configured and forces the output shape and record cap", () => {
    const url = new URL(docRequestUrl(DOC_ENDPOINT));

    // Plaintext, and #60 measured why: TLS to this host is reset from the
    // development network path while the identical plaintext request answers 200.
    expect(url.origin + url.pathname).toBe("http://api.gdeltproject.org/api/v2/doc/doc");
    // The question is the operator's: DOC answers one rather than streaming a
    // window, which is why it lives in the endpoint and not in a column.
    expect(url.searchParams.get("query")).toBe('("artificial intelligence" OR semiconductor) sourcelang:english');
    expect(url.searchParams.get("sort")).toBe("datedesc");
    // Wide enough to clear GDELT's own indexing lag (#60): the newest hour of
    // matches is not indexed yet, so a 1-hour window is empty by construction.
    expect(url.searchParams.get("timespan")).toBe("6h");
    // The output shape is ours, because the parser reads exactly one; and the cap
    // is asked for at GDELT's maximum, because the truncation check only means
    // something there.
    expect(url.searchParams.get("mode")).toBe("artlist");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("maxrecords")).toBe(String(DOC_MAX_RECORDS));
    expect(DOC_MAX_RECORDS).toBe(250);
  });

  it("overrides an output shape the parser cannot read", () => {
    const url = new URL(
      docRequestUrl("https://api.gdeltproject.org/api/v2/doc/doc?query=semiconductor&mode=timelinevol&format=csv"),
    );

    expect(url.searchParams.get("mode")).toBe("artlist");
    expect(url.searchParams.get("format")).toBe("json");
  });

  it("refuses an endpoint with no query rather than asking GDELT for everything", () => {
    expect(() => docRequestUrl("https://api.gdeltproject.org/api/v2/doc/doc")).toThrow(/no "query" parameter/);
    expect(() => docRequestUrl("https://api.gdeltproject.org/api/v2/doc/doc?query=%20&timespan=1d")).toThrow(
      /no "query" parameter/,
    );
  });
});

describe("parseDocArtList", () => {
  it("reads every record of a real artlist response", async () => {
    const articles = parseDocArtList(await artlist());

    expect(articles).toHaveLength(5);
    // GDELT tokenizes titles, so the spacing around punctuation is the real
    // surface form. Only the whitespace tokenization leaves behind is collapsed:
    // `innovative  bio` in the captured response, and nothing else — guessing
    // which spaces were not in the headline would be guessing, and duplicate
    // matching normalizes punctuation away anyway.
    expect(articles[0]).toEqual({
      url: "https://www.fool.com/investing/2026/08/30/not-nvidia-not-amd-this-semiconductor-giant-will/",
      title:
        "Not Nvidia . Not AMD . This Semiconductor Giant Will Be the Ultimate Winner of the " +
        "Artificial Intelligence ( AI ) Hardware Race .",
      // `seendate` is `20260830T181500Z` — the same 14 UTC digits GKG stamps, with
      // separators. It is when GDELT *saw* the document: DOC reports no
      // publication time of its own, and inventing one would be a claim the
      // timeline (ADR-0020) then orders by.
      seenAt: new Date("2026-08-30T18:15:00.000Z"),
    });
    expect(articles.every((article) => article.url !== null && article.title !== null)).toBe(true);
    expect(articles.every((article) => article.seenAt !== null)).toBe(true);
    // Raw, not canonicalized: the two Motley Fool records differ only by a
    // `?source=` tag, and collapsing that is the run's job so a URL is normalized
    // in exactly one place.
    expect(articles[1].url).toContain("?source=");
  });

  it("reads a full response at GDELT's record cap", async () => {
    expect(parseDocArtList(await cappedArtlist())).toHaveLength(DOC_MAX_RECORDS);
  });

  it("nulls the fields of a mutilated record rather than dropping or guessing it", () => {
    const [missing, unusable] = parseDocArtList(
      JSON.stringify({ articles: [{ domain: "example.com" }, { url: "", title: "  ", seendate: "not a stamp" }] }),
    );

    // Every record yields a DocArticle, so the run fails *that item* and counts it
    // — exactly as it does for a malformed feed entry or GKG row.
    expect(missing).toEqual({ url: null, title: null, seenAt: null });
    expect(unusable).toEqual({ url: null, title: null, seenAt: null });
  });

  // Measured 2026-09-01 (#60): a query matching nothing is answered with exactly
  // `{}` — proven by asking for a nonsense term over a day-wide window, and by the
  // seeded query over the newest hour, which GDELT has not indexed yet. So the
  // absent `articles` key is a normal zero-match answer, not the block signal the
  // parser used to read it as.
  it("treats a matched-nothing result set as no records, not a fault", () => {
    expect(parseDocArtList(`{"articles": []}`)).toEqual([]);
    expect(parseDocArtList("{}")).toEqual([]);
    expect(parseDocArtList(" { } ")).toEqual([]);
  });
  // Being refused does not arrive as a missing key: measured, GDELT answers a
  // caller asking too often with a 200 and its own plain-text rate-limit notice,
  // and a blocked one with a page. So "is this JSON at all" is what separates a
  // throttled run from an empty one, and the reason has to be legible on the
  // IngestionRun an Admin then reads.
  it("refuses a body that is not an artlist response, quoting enough of it to diagnose", () => {
    expect(() => parseDocArtList("")).toThrow(/empty body/);
    expect(() =>
      parseDocArtList("Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com"),
    ).toThrow(/non-JSON body: Please limit requests to one every 5 seconds/);
    expect(() =>
      parseDocArtList("<html><head><title>429 Too Many Requests</title></head><body>Rate limited.</body></html>"),
    ).toThrow(/non-JSON body: <html><head><title>429 Too Many Requests/);
    expect(() => parseDocArtList("[]")).toThrow(/no artlist object/);
    expect(() => parseDocArtList(`{"articles": "none"}`)).toThrow(/non-array "articles"/);
  });

  it("bounds how much of a rejected body it quotes", () => {
    const long = `Your query was rejected. ${"detail ".repeat(200)}`;

    expect(() => parseDocArtList(long)).toThrow(/…$/);
    try {
      parseDocArtList(long);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message.length).toBeLessThan(300);
    }
  });
});

// ADR-0018: "Send a browser-like `User-Agent` and throttle (~1 req / few sec) or it
// blocks." The rate limit is real and the API states it in plain text (#60). The
// pacing is proven at the runConnector seam (ingestion.test.ts); the caller identity
// is proven here, without leaving the process. One request only, so the interval
// floor imposes no wait on the suite.
describe("httpFetchDocText", () => {
  it("identifies itself as a browser, and refuses a non-OK response", async () => {
    const seen: Record<string, string>[] = [];
    const fetchStub = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response("Rate limit exceeded.", { status: 429 });
    });

    try {
      // A status GDELT does answer with is a thrown fetch error, which the run turns
      // into a failed IngestionRun with the status and the URL on it.
      await expect(httpFetchDocText(docRequestUrl(DOC_ENDPOINT))).rejects.toThrow(/responded 429/);

      expect(seen).toHaveLength(1);
      const headers = seen[0];
      // The courtesy `TesseraBot` identity the feed and firehose fetchers send is
      // what this endpoint refuses.
      expect(headers["User-Agent"]).toMatch(/^Mozilla\/5\.0 /);
      expect(headers["User-Agent"]).not.toMatch(/Tessera/);
      expect(headers.Accept).toMatch(/application\/json/);
    } finally {
      fetchStub.mockRestore();
    }
  });
});

// Opt-in: `GDELT_LIVE_SMOKE=1 npm test` reaches the real API, which is how a change// in its shape gets noticed. Skipped by default so the suite stays offline and CI
// never depends on a free public service being up — and this endpoint in particular
// blocks a caller that asks too often (ADR-0018), so it must not be on the path of
// an ordinary test run.
describe.runIf(process.env.GDELT_LIVE_SMOKE === "1")("GDELT DOC live smoke", () => {
  it("answers the seeded query with records the connector can read", async () => {
    const articles = parseDocArtList(await httpFetchDocText(docRequestUrl(DOC_ENDPOINT)));

    expect(articles.length).toBeGreaterThan(0);
    // The three fields the connector cannot do without. A majority rather than all,
    // so a bad day upstream does not fail the check while a shape change still does.
    expect(articles.filter((article) => article.url && article.title && article.seenAt).length).toBeGreaterThan(
      articles.length / 2,
    );
  }, 180_000);
});
