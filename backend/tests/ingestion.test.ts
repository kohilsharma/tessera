import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { Article, isStrongerAnalysisTextMode } from "../src/entities/Article";
import { IngestionConnector } from "../src/entities/IngestionConnector";
import { IngestionRun } from "../src/entities/IngestionRun";
import { Publisher } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { User } from "../src/entities/User";
import { signToken } from "../src/auth/jwt";
import { canonicalizeUrl, publisherDomain } from "../src/ingestion/canonicalUrl";
import { runConnector, type FetchText } from "../src/ingestion/runConnector";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

const app = () => createApp();

// Seam 1's injected fetcher: committed captures of real feeds, so parsing is
// proven against real escaping (`&apos;`), real CDATA, real tracking parameters
// and real `content:encoded` — with no network access.
const fixture =
  (name: string): FetchText =>
  () =>
    readFile(join(__dirname, "fixtures", "rss", name), "utf-8");

const failingFetch: FetchText = () => Promise.reject(new Error("getaddrinfo ENOTFOUND feed.invalid"));

let nextConnector = 0;

async function createRssConnector(endpoint: string, enabled = true): Promise<IngestionConnector> {
  nextConnector += 1;
  return AppDataSource.getRepository(IngestionConnector).save({
    name: `Test RSS ${nextConnector}`,
    kind: "rss",
    endpoint,
    enabled,
  });
}

async function createAdminToken(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash("correct-horse", 10);
  const user = await AppDataSource.getRepository(User).save({ email, passwordHash, role: "admin" });
  return signToken({ sub: user.id, role: user.role });
}

async function registerAndLogin(email: string, role: "student" | "investor"): Promise<string> {
  const res = await request(app()).post("/api/v1/auth/register").send({ email, password: "correct-horse", role });
  return res.body.token as string;
}

// Every discovered item must end in exactly one counter, or an operator reading a
// run is reading a number that means nothing.
function countersSumToDiscovered(run: IngestionRun): boolean {
  return (
    run.inserted + run.enriched + run.duplicate + run.rejectedByPolicy + run.failed === run.discovered
  );
}

// ADR-0024's ordered ladder, checked directly: `manual_fixture` sits *outside* it,
// which is the whole reason it is unranked — our own synthetic seed text must not
// be climbable by anything a publisher hands us.
describe("Analysis Text Mode ladder", () => {
  it("orders the ladder upward only and never ranks manual_fixture", () => {
    expect(isStrongerAnalysisTextMode("feed_excerpt", "metadata_only")).toBe(true);
    expect(isStrongerAnalysisTextMode("api_content", "feed_excerpt")).toBe(true);
    expect(isStrongerAnalysisTextMode("licensed_full_text", "api_content")).toBe(true);
    expect(isStrongerAnalysisTextMode("metadata_only", "feed_excerpt")).toBe(false);
    expect(isStrongerAnalysisTextMode("feed_excerpt", "api_content")).toBe(false);
    expect(isStrongerAnalysisTextMode("feed_excerpt", "feed_excerpt")).toBe(false);
    expect(isStrongerAnalysisTextMode("licensed_full_text", "manual_fixture")).toBe(false);
    expect(isStrongerAnalysisTextMode("manual_fixture", "feed_excerpt")).toBe(false);
  });
});

describe("canonical URL", () => {
  it("strips tracking parameters, fragments and trailing slashes, and keeps real ones", () => {
    // The `at_medium`/`at_campaign` pair is what the committed BBC capture
    // actually carries.
    expect(canonicalizeUrl("https://www.bbc.co.uk/news/articles/abc?at_medium=RSS&at_campaign=rss")).toBe(
      "https://www.bbc.co.uk/news/articles/abc",
    );
    expect(canonicalizeUrl("https://example.com/story/#0")).toBe("https://example.com/story");
    expect(canonicalizeUrl("https://example.com/?utm_source=feed&id=7")).toBe("https://example.com/?id=7");
    expect(canonicalizeUrl("https://example.com/a?b=2&a=1")).toBe(canonicalizeUrl("https://example.com/a?a=1&b=2"));
    expect(canonicalizeUrl("/news/articles/abc")).toBeNull();
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
  });

  // The host is left as the publisher served it, because the canonical URL is
  // also the outbound link; `www` aliasing is resolved for Publisher identity
  // instead, where nothing navigates to the value.
  it("keeps the host the publisher linked, and keys Publishers on it without www", () => {
    expect(canonicalizeUrl("https://www.npr.org/2026/08/30/story")).toBe("https://www.npr.org/2026/08/30/story");
    expect(publisherDomain("https://www.npr.org/2026/08/30/story")).toBe("npr.org");
    expect(publisherDomain("https://npr.org/2026/08/30/story")).toBe("npr.org");
  });
});

describe("runConnector over an RSS feed", () => {
  // The committed fixtures are the same real documents in every test here, and a
  // canonical URL is a global identity — so without a reset, the second test to
  // read a fixture sees the first test's rows as duplicates. Connectors are left
  // alone (articles reference them); everything ingestion writes is cleared.
  beforeEach(async () => {
    await AppDataSource.query(`TRUNCATE "articles", "publishers", "ingestion_runs" CASCADE`);
  });

  it("lands real reporting as Unclustered Articles and auto-creates their Publisher", async () => {
    const connector = await createRssConnector("https://npr.example/feed.xml");

    const run = await runConnector(connector, { fetchText: fixture("npr-world.xml") });

    expect(run).not.toBeNull();
    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(3);
    expect(run!.inserted).toBe(3);
    expect(run!.failed).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(run!.completedAt).not.toBeNull();
    // RSS's nearest thing to a cursor is when the publisher last rebuilt the feed.
    expect(run!.cursor).toBe("Sun, 30 Aug 2026 11:23:58 -0400");

    const articles = await AppDataSource.getRepository(Article).find({
      where: { discoveredByConnectorId: connector.id },
      relations: { publisher: true },
    });
    expect(articles).toHaveLength(3);
    for (const article of articles) {
      // The structural invariant: no Story, so every public read path — all of
      // which join through Story — cannot see it (ADR-0007).
      expect(article.storyId).toBeNull();
      expect(article.analysisTextMode).toBe("feed_excerpt");
      expect(article.publisher.domain).toBe("npr.org");
      // Named from the feed's channel title, keyed on the unique domain.
      expect(article.publisher.name).toBe("NPR Topics: World");
      // #40: a Publisher nobody has classified is `internal_only`, so its text is
      // held for analysis and never served — the rights gate fails closed.
      expect(article.publisher.termsClass).toBe("internal_only");
    }

    // content:encoded is HTML in a CDATA block: what lands is the text, not the
    // markup or the tracking pixel the publisher embedded in it.
    const lake = articles.find((article) => article.title.includes("Lake Ontario"));
    expect(lake).toBeDefined();
    expect(lake!.analysisText).not.toContain("<");
    expect(lake!.analysisText).not.toContain("npr-rss-pixel");
    expect(lake!.analysisText).toContain("Ontario Premier Doug Ford");
    // `&apos;` in the real feed's title, decoded rather than stored raw.
    expect(lake!.title).toContain("Trump's");
  });

  it("inserts nothing on a re-run over unchanged source and counts the items as duplicates", async () => {
    const connector = await createRssConnector("https://bbc.example/feed.xml");
    const fetchText = fixture("bbc-world.xml");

    const first = await runConnector(connector, { fetchText });
    expect(first!.inserted).toBe(3);

    const second = await runConnector(connector, { fetchText });

    expect(second!.status).toBe("succeeded");
    expect(second!.discovered).toBe(3);
    expect(second!.inserted).toBe(0);
    expect(second!.duplicate).toBe(3);
    expect(countersSumToDiscovered(second!)).toBe(true);
    expect(await AppDataSource.getRepository(Article).countBy({ discoveredByConnectorId: connector.id })).toBe(3);
  });

  it("counts cross-connector sightings with no new contribution as duplicates", async () => {
    const firstConnector = await createRssConnector("https://bbc-one.example/feed.xml");
    const secondConnector = await createRssConnector("https://bbc-two.example/feed.xml");
    const fetchText = fixture("bbc-world.xml");

    expect((await runConnector(firstConnector, { fetchText }))!.inserted).toBe(3);
    const overlap = await runConnector(secondConnector, { fetchText });
    const rerun = await runConnector(secondConnector, { fetchText });

    for (const run of [overlap, rerun]) {
      expect(run!.inserted).toBe(0);
      expect(run!.enriched).toBe(0);
      expect(run!.duplicate).toBe(3);
      expect(countersSumToDiscovered(run!)).toBe(true);
    }
    expect(await AppDataSource.getRepository(Article).count()).toBe(3);
  });

  it("enriches a metadata-only Article when another connector contributes excerpt text", async () => {
    const sourceConnector = await createRssConnector("https://metadata.example/feed.xml");
    const rssConnector = await createRssConnector("https://bbc-enrichment.example/feed.xml");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "BBC News",
      domain: "bbc.co.uk",
    });
    const held = await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      discoveredByConnectorId: sourceConnector.id,
      title: "Iceland votes against restarting EU membership talks",
      url: "https://www.bbc.co.uk/news/articles/c70le8ed1plo",
      analysisText: null,
      analysisTextMode: "metadata_only",
      publishedAt: new Date("2026-08-30T14:45:05Z"),
    });

    const run = await runConnector(rssConnector, { fetchText: fixture("bbc-world.xml") });

    expect(run!.inserted).toBe(2);
    expect(run!.enriched).toBe(1);
    expect(run!.duplicate).toBe(0);
    const enriched = await AppDataSource.getRepository(Article).findOneByOrFail({ id: held.id });
    expect(enriched.analysisTextMode).toBe("feed_excerpt");
    expect(enriched.analysisText).toContain("Broadcaster RUV reports");
    expect(enriched.discoveredByConnectorId).toBe(sourceConnector.id);
  });

  it("counts only one concurrent enrichment of the same canonical URL", async () => {
    const concurrency = 8;
    const sourceConnector = await createRssConnector("https://metadata-race.example/feed.xml");
    const connectors = await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        createRssConnector(`https://enrichment-race-${index}.example/feed.xml`),
      ),
    );
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "Race News",
      domain: "race.example",
    });
    await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      discoveredByConnectorId: sourceConnector.id,
      title: "Original metadata title",
      url: "https://race.example/shared-report",
      analysisText: null,
      analysisTextMode: "metadata_only",
      publishedAt: new Date("2026-08-30T12:00:00Z"),
    });
    let ready = 0;
    let release!: () => void;
    const allReady = new Promise<void>((resolve) => {
      release = resolve;
    });

    const completed = await Promise.all(
      connectors.map((connector, index) =>
        runConnector(connector, {
          fetchText: async () => {
            ready += 1;
            if (ready === concurrency) release();
            await allReady;
            return `<?xml version="1.0"?><rss version="2.0"><channel><title>Race News</title><item><title>Variant ${index}</title><link>https://race.example/shared-report</link><pubDate>${new Date(Date.UTC(2026, 7, 30 + index)).toUTCString()}</pubDate><description>Excerpt ${index}.</description></item></channel></rss>`;
          },
        }),
      ),
    );

    expect(completed.reduce((sum, run) => sum + run!.enriched, 0)).toBe(1);
    expect(completed.reduce((sum, run) => sum + run!.duplicate, 0)).toBe(concurrency - 1);
    expect(completed.reduce((sum, run) => sum + run!.failed, 0)).toBe(0);
    expect(await AppDataSource.getRepository(Article).count()).toBe(1);
  });

  it("stores the canonical URL, so a tracked feed link is not a second Article", async () => {
    const connector = await createRssConnector("https://bbc-canonical.example/feed.xml");

    await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    const urls = (
      await AppDataSource.getRepository(Article).find({
        where: { discoveredByConnectorId: connector.id },
        select: { url: true },
      })
    ).map((article) => article.url);
    expect(urls).toContain("https://www.bbc.co.uk/news/articles/c70le8ed1plo");
    expect(urls.every((url) => !url.includes("at_medium"))).toBe(true);
  });

  it("rejects the same reporting at a different canonical URL as a Duplicate", async () => {
    const connector = await createRssConnector("https://bbc-syndicated.example/feed.xml");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "BBC News",
      domain: "bbc.co.uk",
    });
    // Same reporting, same publisher, same day — re-punctuated and at another URL,
    // which is exactly what normalized-title matching is for.
    await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      title: "Iceland Votes Against Restarting EU Membership Talks!",
      url: "https://bbc.co.uk/news/world-europe-99999999",
      analysisText: "Broadcaster RUV reports the result.",
      analysisTextMode: "feed_excerpt",
      publishedAt: new Date("2026-08-30T09:00:00Z"),
    });

    const run = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    expect(run!.discovered).toBe(3);
    expect(run!.inserted).toBe(2);
    expect(run!.duplicate).toBe(1);
    expect(countersSumToDiscovered(run!)).toBe(true);
  });

  it("atomically rejects concurrent different-URL duplicates", async () => {
    const concurrency = 8;
    const connectors = await Promise.all(
      Array.from({ length: concurrency }, (_, index) =>
        createRssConnector(`https://concurrent-${index}.example/feed.xml`),
      ),
    );
    let ready = 0;
    let release!: () => void;
    const allReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runs = connectors.map((connector, index) =>
      runConnector(connector, {
        fetchText: async () => {
          ready += 1;
          if (ready === concurrency) release();
          await allReady;
          return `<?xml version="1.0"?><rss version="2.0"><channel><title>Concurrent News</title><item><title>One shared report</title><link>https://concurrent.example/report-${index}</link><pubDate>Sun, 30 Aug 2026 12:00:00 GMT</pubDate><description>Shared report text.</description></item></channel></rss>`;
        },
      }),
    );

    const completed = await Promise.all(runs);

    expect(completed.reduce((sum, run) => sum + run!.inserted, 0)).toBe(1);
    expect(completed.reduce((sum, run) => sum + run!.duplicate, 0)).toBe(concurrency - 1);
    expect(completed.reduce((sum, run) => sum + run!.failed, 0)).toBe(0);
    expect(await AppDataSource.getRepository(Article).count()).toBe(1);
  });

  it("never lets a weaker sighting degrade text already held for the same URL", async () => {
    const connector = await createRssConnector("https://bbc-held.example/feed.xml");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "BBC Held",
      domain: "bbc-held.co.uk",
    });
    const held = await AppDataSource.getRepository(Article).save({
      storyId: null,
      publisherId: publisher.id,
      title: "Iceland votes against restarting EU membership talks",
      // The canonical form of the first item in the committed BBC capture.
      url: "https://www.bbc.co.uk/news/articles/c70le8ed1plo",
      analysisText: "The licensed full text we already hold.",
      analysisTextMode: "licensed_full_text",
      publishedAt: new Date("2026-08-30T14:45:05Z"),
    });

    const run = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    expect(run!.duplicate).toBe(1);
    expect(run!.enriched).toBe(0);
    const after = await AppDataSource.getRepository(Article).findOneByOrFail({ id: held.id });
    expect(after.analysisTextMode).toBe("licensed_full_text");
    expect(after.analysisText).toBe("The licensed full text we already hold.");
    expect(after.discoveredByConnectorId).toBeNull();
  });

  it("rejects text-bearing items from a metadata-only Publisher on rights grounds", async () => {
    const connector = await createRssConnector("https://bbc-metadata-only.example/feed.xml");
    // Hand-classified: this publisher has cleared its metadata and nothing else,
    // so an RSS excerpt is text Tessera may not keep at all (#40).
    await AppDataSource.getRepository(Publisher).save({
      name: "BBC News",
      domain: "bbc.co.uk",
      termsClass: "open_metadata",
    });

    const run = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(3);
    expect(run!.rejectedByPolicy).toBe(3);
    expect(run!.inserted).toBe(0);
    expect(run!.failed).toBe(0);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(await AppDataSource.getRepository(Article).count()).toBe(0);
  });

  it("fails a malformed item and not the run, and says why", async () => {
    const connector = await createRssConnector("https://malformed.example/feed.xml");

    const run = await runConnector(connector, { fetchText: fixture("bbc-world-malformed.xml") });

    // One item has no date, one has a site-relative link; the third is intact.
    expect(run!.status).toBe("succeeded");
    expect(run!.discovered).toBe(3);
    expect(run!.inserted).toBe(1);
    expect(run!.failed).toBe(2);
    expect(countersSumToDiscovered(run!)).toBe(true);
    expect(run!.errorSummary).toMatch(/no parseable date/);
    expect(run!.errorSummary).toMatch(/not an absolute http\(s\) URL/);
  });

  it("loses nothing when two runs race on the same feed", async () => {
    const connector = await createRssConnector("https://race.example/feed.xml");
    const fetchText = fixture("bbc-world.xml");

    // Both runs read an empty table, so both try to insert all three URLs and the
    // unique constraint is what settles it — the path a real second connector
    // takes when it sights a URL between another's read and write.
    const [first, second] = await Promise.all([
      runConnector(connector, { fetchText }),
      runConnector(connector, { fetchText }),
    ]);

    expect(first!.status).toBe("succeeded");
    expect(second!.status).toBe("succeeded");
    expect(countersSumToDiscovered(first!)).toBe(true);
    expect(countersSumToDiscovered(second!)).toBe(true);
    // Three documents, three rows, and no item lost to the race on either side.
    expect(await AppDataSource.getRepository(Article).count()).toBe(3);
    expect(first!.inserted + second!.inserted).toBe(3);
    expect(first!.failed + second!.failed).toBe(0);
  });

  it("records an unreachable feed as a failed run with an error summary", async () => {
    const connector = await createRssConnector("https://feed.invalid/feed.xml");

    const run = await runConnector(connector, { fetchText: failingFetch });

    expect(run!.status).toBe("failed");
    expect(run!.errorSummary).toContain("ENOTFOUND");
    expect(run!.discovered).toBe(0);
    expect(run!.completedAt).not.toBeNull();
  });

  it("does not run a disabled connector, and records nothing", async () => {
    const connector = await createRssConnector("https://disabled.example/feed.xml", false);

    const run = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    expect(run).toBeNull();
    expect(await AppDataSource.getRepository(IngestionRun).countBy({ connectorId: connector.id })).toBe(0);
    expect(await AppDataSource.getRepository(Article).countBy({ discoveredByConnectorId: connector.id })).toBe(0);
  });

  it("fails a run for a connector kind that has no implementation yet", async () => {
    const connector = await AppDataSource.getRepository(IngestionConnector).save({
      name: "GKG not yet built",
      kind: "gdelt_gkg",
      endpoint: "http://data.gdeltproject.org/gdeltv2/lastupdate.txt",
      enabled: true,
    });

    const run = await runConnector(connector, { fetchText: failingFetch });

    expect(run!.status).toBe("failed");
    expect(run!.errorSummary).toContain("gdelt_gkg");
  });
});

describe("a completed run does not disturb the curated corpus", () => {
  let token: string;

  beforeAll(async () => {
    token = await registerAndLogin("ingestion-reader@example.com", "student");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "Curated Press",
      domain: "curated-press.example",
    });
    const story = await AppDataSource.getRepository(Story).save({
      slug: "curated-corpus-story",
      title: "Packaging capacity expands",
      summary: "A curated fixture Story.",
      category: "technology",
      firstSeenAt: new Date("2026-02-01T00:00:00Z"),
      lastSeenAt: new Date("2026-02-01T00:00:00Z"),
    });
    await AppDataSource.getRepository(Article).save({
      storyId: story.id,
      publisherId: publisher.id,
      title: "Fab announces new packaging line",
      url: "https://curated-press.example/packaging-line",
      analysisText: "A new advanced packaging line.",
      analysisTextMode: "manual_fixture",
      publishedAt: new Date("2026-02-01T00:00:00Z"),
    });
  });

  it("leaves Story browse and search results identical", async () => {
    const stories = () => request(app()).get("/api/v1/stories").set("Authorization", `Bearer ${token}`);
    const search = () =>
      request(app()).get("/api/v1/search?q=packaging").set("Authorization", `Bearer ${token}`);

    const storiesBefore = await stories();
    const searchBefore = await search();
    expect(searchBefore.body.total).toBeGreaterThan(0);

    const connector = await createRssConnector("https://undisturbed.example/feed.xml");
    const run = await runConnector(connector, { fetchText: fixture("npr-world.xml") });
    expect(run!.inserted).toBeGreaterThan(0);

    expect((await stories()).body).toEqual(storiesBefore.body);
    expect((await search()).body).toEqual(searchBefore.body);
  });

  it("404s an Unclustered Article requested by id rather than 500ing on its absent Story", async () => {
    const connector = await createRssConnector("https://unclustered.example/feed.xml");
    await runConnector(connector, { fetchText: fixture("bbc-world.xml") });
    const article = await AppDataSource.getRepository(Article).findOneByOrFail({
      discoveredByConnectorId: connector.id,
    });

    const res = await request(app())
      .get(`/api/v1/articles/${article.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// Seam 2: only what is HTTP-visible. The endpoint's RBAC, that it runs the
// connector and persists a run, and that the Admin dashboard carries the history.
describe("the Admin ingestion surface", () => {
  // A closed local port, so the run reaches runConnector and persists a row
  // without any external network: what this asserts is that the endpoint wires
  // through to the run function, not what the run function does.
  const CLOSED_PORT_FEED = "http://127.0.0.1:1/feed.xml";

  it("is Admin-only", async () => {
    const connector = await createRssConnector(CLOSED_PORT_FEED);
    const path = `/api/v1/ingestion/connectors/${connector.id}/run`;

    expect((await request(app()).post(path)).status).toBe(401);

    const student = await registerAndLogin("ingestion-student@example.com", "student");
    expect((await request(app()).post(path).set("Authorization", `Bearer ${student}`)).status).toBe(403);

    const investor = await registerAndLogin("ingestion-investor@example.com", "investor");
    expect((await request(app()).post(path).set("Authorization", `Bearer ${investor}`)).status).toBe(403);
  });

  it("runs a connector on demand and persists the run", async () => {
    const token = await createAdminToken("ingestion-admin@example.com");
    const connector = await createRssConnector(CLOSED_PORT_FEED);

    const res = await request(app())
      .post(`/api/v1/ingestion/connectors/${connector.id}/run`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(res.body.connectorId).toBe(connector.id);
    expect(await AppDataSource.getRepository(IngestionRun).countBy({ connectorId: connector.id })).toBe(1);
  });

  it("refuses to run a disabled connector, and 404s an unknown one", async () => {
    const token = await createAdminToken("ingestion-admin-disabled@example.com");
    const disabled = await createRssConnector(CLOSED_PORT_FEED, false);

    const refused = await request(app())
      .post(`/api/v1/ingestion/connectors/${disabled.id}/run`)
      .set("Authorization", `Bearer ${token}`);
    expect(refused.status).toBe(422);

    const missing = await request(app())
      .post(`/api/v1/ingestion/connectors/00000000-0000-0000-0000-000000000000/run`)
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });

  it("lets an Admin disable a connector without a deploy, and nobody else", async () => {
    const token = await createAdminToken("ingestion-admin-toggle@example.com");
    const connector = await createRssConnector(CLOSED_PORT_FEED);

    const disabled = await request(app())
      .patch(`/api/v1/ingestion/connectors/${connector.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
    expect((await AppDataSource.getRepository(IngestionConnector).findOneByOrFail({ id: connector.id })).enabled).toBe(
      false,
    );

    const student = await registerAndLogin("ingestion-toggle-student@example.com", "student");
    const forbidden = await request(app())
      .patch(`/api/v1/ingestion/connectors/${connector.id}`)
      .set("Authorization", `Bearer ${student}`)
      .send({ enabled: true });
    expect(forbidden.status).toBe(403);

    const invalid = await request(app())
      .patch(`/api/v1/ingestion/connectors/${connector.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: "yes" });
    expect(invalid.status).toBe(422);
  });

  it("carries IngestionRun history on the Admin dashboard payload, newest first", async () => {
    const token = await createAdminToken("ingestion-admin-history@example.com");
    const connector = await createRssConnector("https://history.example/feed.xml");
    const older = await runConnector(connector, { fetchText: failingFetch });
    const newer = await runConnector(connector, { fetchText: fixture("bbc-world.xml") });

    const res = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const runs = res.body.ingestionRuns as {
      id: string;
      connectorName: string;
      status: string;
      errorSummary: string | null;
    }[];
    const ours = runs.filter((run) => run.connectorName === connector.name);
    expect(ours.map((run) => run.id)).toEqual([newer!.id, older!.id]);
    expect(ours[0]).toMatchObject({ status: "succeeded", discovered: 3 });
    expect(ours[1]).toMatchObject({ status: "failed" });
    expect(ours[1].errorSummary).toContain("ENOTFOUND");
  });
});
