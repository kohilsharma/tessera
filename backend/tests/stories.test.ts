import "reflect-metadata";
import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { Publisher } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { Article } from "../src/entities/Article";
import { EvidenceSet } from "../src/entities/EvidenceSet";
import { GenerationRun } from "../src/entities/GenerationRun";
import { buildTimeline, type TimelineArticle } from "../src/timeline/buildTimeline";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

const app = () => createApp();

const unknownStoryId = "00000000-0000-0000-0000-000000000000";
const unknownArticleId = "00000000-0000-0000-0000-000000000000";

let token: string;
let storyAlphaId: string;
let articleAlphaOneId: string;
let fixtureTextWithheldArticleId: string;
let internalTextArticleId: string;
let licensedFullTextArticleId: string;
let extractedTextArticleId: string;
let tiedStoryIds: string[];
let timelineStoryId: string;

beforeAll(async () => {
  const registerRes = await request(app())
    .post("/api/v1/auth/register")
    .send({ email: "browse@example.com", password: "correct-horse", role: "student" });
  token = registerRes.body.token;

  const publishers = AppDataSource.getRepository(Publisher);
  const stories = AppDataSource.getRepository(Story);
  const articles = AppDataSource.getRepository(Article);

  const publisherA = await publishers.save({
    name: "Publisher A",
    domain: "publisher-a.example",
    // Cleared to serve its text (#40); Publisher B is pinned to `internal_only`,
    // so the two cover both sides of the rights gate. Pinned rather than defaulted
    // because since ADR-0032 the default is `licensed`.
    termsClass: "licensed",
  });
  const publisherB = await publishers.save({
    name: "Publisher B",
    domain: "publisher-b.example",
    termsClass: "internal_only" as const,
  });

  const storyAlpha = await stories.save({
    slug: "story-alpha",
    title: "Story Alpha",
    summary: "First technology story.",
    category: "technology",
    firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-01-01T12:00:00Z"),
  });
  storyAlphaId = storyAlpha.id;
  const articleAlphaOne = await articles.save({
    storyId: storyAlpha.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherA.id,
    title: "Alpha, from Publisher A",
    url: "https://publisher-a.example/alpha",
    analysisText: "Alpha coverage from Publisher A.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
  });
  articleAlphaOneId = articleAlphaOne.id;
  const articleAlphaTwo = await articles.save({
    storyId: storyAlpha.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherB.id,
    title: "Alpha, from Publisher B",
    url: "https://publisher-b.example/alpha",
    analysisText: "Alpha coverage from Publisher B.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-01-01T12:00:00Z"),
  });
  fixtureTextWithheldArticleId = articleAlphaTwo.id;

  const storyBeta = await stories.save({
    slug: "story-beta",
    title: "Story Beta",
    summary: null,
    category: "technology",
    firstSeenAt: new Date("2026-01-03T00:00:00Z"),
    lastSeenAt: new Date("2026-01-03T00:00:00Z"),
  });
  await articles.save({
    storyId: storyBeta.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherA.id,
    title: "Beta, from Publisher A",
    url: "https://publisher-a.example/beta",
    analysisText: "Beta coverage.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-01-03T00:00:00Z"),
  });
  // A body we hold for analysis but may not serve: its Publisher's Terms Class
  // is the fail-closed default (#40).
  const internalTextArticle = await articles.save({
    storyId: storyBeta.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherB.id,
    title: "Beta, from Publisher B",
    url: "https://publisher-b.example/beta",
    analysisText: "Licensed body text that must never leave the API.",
    analysisTextMode: "licensed_full_text",
    publishedAt: new Date("2026-01-03T06:00:00Z"),
  });
  internalTextArticleId = internalTextArticle.id;
  // The same mode from a Publisher that *is* cleared to serve text: the Terms
  // Class decides, not the Analysis Text Mode allowlist it replaced (#40).
  const licensedFullTextArticle = await articles.save({
    storyId: storyBeta.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherA.id,
    title: "Beta follow-up, from Publisher A",
    url: "https://publisher-a.example/beta-follow-up",
    analysisText: "Licensed body text Publisher A cleared for redistribution.",
    analysisTextMode: "licensed_full_text",
    publishedAt: new Date("2026-01-03T09:00:00Z"),
  });
  licensedFullTextArticleId = licensedFullTextArticle.id;
  // A body Tessera extracted from the page itself, under a cleared Publisher.
  // ADR-0032 lifted the floor that used to refuse this whatever the class: it is
  // the text the analysis rests on, and a citation has to open onto something.
  const extractedTextArticle = await articles.save({
    storyId: storyBeta.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherA.id,
    title: "Beta extraction, from Publisher A",
    url: "https://publisher-a.example/beta-extraction",
    analysisText: "Body text Tessera extracted from the page itself.",
    analysisTextMode: "api_content",
    publishedAt: new Date("2026-01-03T10:00:00Z"),
  });
  extractedTextArticleId = extractedTextArticle.id;

  const storyGamma = await stories.save({
    slug: "story-gamma",
    title: "Story Gamma",
    summary: null,
    category: "business",
    firstSeenAt: new Date("2026-01-02T00:00:00Z"),
    lastSeenAt: new Date("2026-01-02T00:00:00Z"),
  });
  await articles.save({
    storyId: storyGamma.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherA.id,
    title: "Gamma, from Publisher A",
    url: "https://publisher-a.example/gamma",
    analysisText: "Gamma coverage.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-01-02T00:00:00Z"),
  });

  const storyDelta = await stories.save({
    slug: "story-delta",
    title: "Story Delta",
    summary: null,
    category: "technology",
    firstSeenAt: new Date("2026-01-05T00:00:00Z"),
    lastSeenAt: new Date("2026-01-05T00:00:00Z"),
  });
  await articles.save({
    storyId: storyDelta.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherA.id,
    title: "Delta, from Publisher A",
    url: "https://publisher-a.example/delta",
    analysisText: "Delta coverage.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-01-05T00:00:00Z"),
  });

  const storyEcho = await stories.save({
    slug: "story-echo",
    title: "Story Echo",
    summary: null,
    category: "business",
    firstSeenAt: new Date("2026-01-04T00:00:00Z"),
    lastSeenAt: new Date("2026-01-04T00:00:00Z"),
  });
  await articles.save({
    storyId: storyEcho.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherA.id,
    title: "Echo, from Publisher A",
    url: "https://publisher-a.example/echo",
    analysisText: "Echo coverage.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-01-04T00:00:00Z"),
  });

  // Five Stories tied on firstSeenAt, in a category no other test touches, so
  // paging through them exercises the primary-key tiebreaker in isolation. Five
  // rather than two because ids are random uuids: without the tiebreaker Postgres
  // hands back heap (insertion) order, which matches id-ascending by chance 1/2
  // of the time for a pair but 1/120 for five. Dated before every other fixture
  // and named after them alphabetically, so they sit at the tail of both sorts.
  const tied = [];
  for (const suffix of ["One", "Two", "Three", "Four", "Five"]) {
    const tiedStory = await stories.save({
      slug: `story-tied-${suffix.toLowerCase()}`,
      title: `Story Tied ${suffix}`,
      summary: null,
      category: "science",
      firstSeenAt: new Date("2025-12-01T00:00:00Z"),
      lastSeenAt: new Date("2025-12-01T00:00:00Z"),
    });
    await articles.save({
      storyId: tiedStory.id,
      storyAssignmentStatus: "auto_accepted" as const,
      publisherId: publisherA.id,
      title: `Tied ${suffix}, from Publisher A`,
      url: `https://publisher-a.example/tied-${suffix.toLowerCase()}`,
      analysisText: `Tied ${suffix} coverage.`,
      analysisTextMode: "manual_fixture",
      publishedAt: new Date("2025-12-01T00:00:00Z"),
    });
    tied.push(tiedStory.id);
  }
  tiedStoryIds = tied;

  const storyLateInDay = await stories.save({
    slug: "story-late-in-day",
    title: "Story Late In Day",
    summary: null,
    category: "health",
    firstSeenAt: new Date("2025-11-15T18:30:00Z"),
    lastSeenAt: new Date("2025-11-15T18:30:00Z"),
  });
  await articles.save({
    storyId: storyLateInDay.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherA.id,
    title: "Late In Day, from Publisher A",
    url: "https://publisher-a.example/late-in-day",
    analysisText: "Late-in-day coverage.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2025-11-15T18:30:00Z"),
  });

  // #64's own Story, so the timeline's fixtures — a pending proposal, a frozen
  // EvidenceSet, one completed analysis and one failed one — sit clear of the
  // browse tests that assert on exact Article lists.
  const storyTimeline = await stories.save({
    slug: "story-timeline",
    title: "Story Timeline",
    summary: null,
    category: "world",
    firstSeenAt: new Date("2026-02-01T00:00:00Z"),
    lastSeenAt: new Date("2026-02-05T00:00:00Z"),
  });
  timelineStoryId = storyTimeline.id;
  await articles.save({
    storyId: storyTimeline.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherA.id,
    title: "Timeline, first report",
    url: "https://publisher-a.example/timeline-first",
    analysisText: "First timeline report.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-02-01T00:00:00Z"),
  });
  await articles.save({
    storyId: storyTimeline.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisherB.id,
    title: "Timeline, second report",
    url: "https://publisher-b.example/timeline-second",
    analysisText: "Second timeline report.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-02-05T00:00:00Z"),
  });
  // A proposal, not a member (#50): it carries this Story's id and must never reach
  // a reader surface, this one included.
  await articles.save({
    storyId: storyTimeline.id,
    storyAssignmentStatus: "pending_review" as const,
    publisherId: publisherA.id,
    title: "Timeline, merely proposed",
    url: "https://publisher-a.example/timeline-proposed",
    analysisText: "A proposal awaiting review.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-02-03T00:00:00Z"),
  });
  const evidenceSet = await AppDataSource.getRepository(EvidenceSet).save({
    storyId: storyTimeline.id,
    contentHash: "timeline-evidence-hash",
    articleCount: 2,
    distinctPublisherCount: 2,
    dataMode: "manual_fixture" as const,
    createdAt: new Date("2026-02-05T06:00:00Z"),
  });
  const generationRuns = AppDataSource.getRepository(GenerationRun);
  await generationRuns.save({
    storyId: storyTimeline.id,
    evidenceSetId: evidenceSet.id,
    lens: "student_context" as const,
    promptVersion: "test",
    status: "completed" as const,
    provider: "mock",
    model: "mock",
    startedAt: new Date("2026-02-05T06:59:00Z"),
    completedAt: new Date("2026-02-05T07:00:00Z"),
  });
  // A failed run put nothing on the record's history, so it puts nothing on its axis.
  await generationRuns.save({
    storyId: storyTimeline.id,
    evidenceSetId: evidenceSet.id,
    lens: "student_context" as const,
    promptVersion: "test",
    status: "failed" as const,
    failureCode: "provider_error" as const,
    provider: "mock",
    model: "mock",
    startedAt: new Date("2026-02-05T08:00:00Z"),
    completedAt: new Date("2026-02-05T08:00:01Z"),
  });
});

describe("GET /api/v1/stories", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app()).get("/api/v1/stories");
    expect(res.status).toBe(401);
  });

  it("filters by category", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ category: "technology" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items.map((s: { title: string }) => s.title).sort()).toEqual([
      "Story Alpha",
      "Story Beta",
      "Story Delta",
    ]);
  });

  it("returns an empty envelope, not an error, for a category with no matches", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ category: "sports" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.totalPages).toBe(1);
  });

  it("rejects an unknown category with 422", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ category: "not-a-real-category" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(422);
  });

  it("sorts by title ascending", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ sort: "title:asc", pageSize: 50 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.slice(0, 5).map((s: { title: string }) => s.title)).toEqual([
      "Story Alpha",
      "Story Beta",
      "Story Delta",
      "Story Echo",
      "Story Gamma",
    ]);
  });

  it("sorts by firstSeenAt descending by default", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ pageSize: 50 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.slice(0, 6).map((s: { title: string }) => s.title)).toEqual([
      "Story Timeline",
      "Story Delta",
      "Story Echo",
      "Story Beta",
      "Story Gamma",
      "Story Alpha",
    ]);
  });

  it("paginates with page/pageSize and reports total/totalPages", async () => {
    const page1 = await request(app())
      .get("/api/v1/stories")
      .query({ pageSize: 2, page: 1, sort: "title:asc" })
      .set("Authorization", `Bearer ${token}`);
    const page2 = await request(app())
      .get("/api/v1/stories")
      .query({ pageSize: 2, page: 2, sort: "title:asc" })
      .set("Authorization", `Bearer ${token}`);

    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ page: 1, pageSize: 2, total: 12, totalPages: 6 });
    expect(page1.body.items.map((s: { title: string }) => s.title)).toEqual(["Story Alpha", "Story Beta"]);

    expect(page2.status).toBe(200);
    expect(page2.body.items.map((s: { title: string }) => s.title)).toEqual(["Story Delta", "Story Echo"]);
  });

  it("filters by date range on firstSeenAt", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ dateFrom: "2026-01-02T00:00:00Z", dateTo: "2026-01-04T00:00:00Z", sort: "title:asc" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { title: string }) => s.title)).toEqual([
      "Story Beta",
      "Story Echo",
      "Story Gamma",
    ]);
  });

  it("orders rows tied on the sort column by id, so pages neither repeat nor drop one", async () => {
    const pages = await Promise.all(
      [1, 2, 3, 4, 5].map((page) =>
        request(app())
          .get("/api/v1/stories")
          .query({ category: "science", pageSize: 1, page })
          .set("Authorization", `Bearer ${token}`),
      ),
    );

    expect(pages.map((p) => p.status)).toEqual([200, 200, 200, 200, 200]);
    expect(pages[0].body.total).toBe(tiedStoryIds.length);
    // Every tied Story exactly once, in the tiebreaker's order.
    expect(pages.map((p) => p.body.items[0].id)).toEqual([...tiedStoryIds].sort());
  });

  it("treats a date-only dateTo as inclusive to the end of that day", async () => {
    // Story Late In Day was first seen at 18:30, so a bound parsed as midnight
    // would silently drop it from a range whose UI reads "to 15 Nov".
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ dateFrom: "2025-11-15", dateTo: "2025-11-15" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { title: string }) => s.title)).toEqual(["Story Late In Day"]);
  });

  it("rejects an inverted date range with 422", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ dateFrom: "2026-01-04", dateTo: "2026-01-02" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(422);
  });

  it("rejects an unknown sort field with 422", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ sort: "embedding:asc" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(422);
  });

  it("reports articleCount per Story in the list", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ category: "technology", sort: "title:asc" })
      .set("Authorization", `Bearer ${token}`);

    const alpha = res.body.items.find((s: { title: string }) => s.title === "Story Alpha");
    expect(alpha.articleCount).toBe(2);
  });
});

describe("GET /api/v1/stories/:id", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app()).get(`/api/v1/stories/${storyAlphaId}`);
    expect(res.status).toBe(401);
  });

  it("returns the Story with its Articles and Publishers, ordered by publishedAt", async () => {
    const res = await request(app())
      .get(`/api/v1/stories/${storyAlphaId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Story Alpha");
    expect(res.body.articleCount).toBe(2);
    expect(res.body.articles).toHaveLength(2);
    expect(res.body.articles.map((a: { title: string }) => a.title)).toEqual([
      "Alpha, from Publisher A",
      "Alpha, from Publisher B",
    ]);
    expect(res.body.articles[0].publisher).toMatchObject({ name: "Publisher A", domain: "publisher-a.example" });
  });

  it("returns 404 for a well-formed but unknown Story id", async () => {
    const res = await request(app())
      .get(`/api/v1/stories/${unknownStoryId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 rather than 500 for a malformed id", async () => {
    const res = await request(app()).get("/api/v1/stories/not-a-uuid").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/articles/:id", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app()).get(`/api/v1/articles/${articleAlphaOneId}`);
    expect(res.status).toBe(401);
  });

  it("returns Article detail with its Publisher and Story", async () => {
    const res = await request(app())
      .get(`/api/v1/articles/${articleAlphaOneId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: "Alpha, from Publisher A",
      analysisText: "Alpha coverage from Publisher A.",
      publisher: { name: "Publisher A", domain: "publisher-a.example" },
      story: { title: "Story Alpha" },
    });
  });

  it("withholds analysisText when the Publisher's Terms Class does not allow serving it (#40)", async () => {
    const res = await request(app())
      .get(`/api/v1/articles/${internalTextArticleId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.analysisTextMode).toBe("licensed_full_text");
    expect(res.body.analysisText).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("must never leave the API");
  });

  // Both directions, because the Terms Class replaced an Analysis Text Mode
  // allowlist: a cleared publisher's non-fixture text is served, and an
  // unclassified publisher's fixture-mode text is not.
  it("serves a cleared Publisher's licensed body text", async () => {
    const res = await request(app())
      .get(`/api/v1/articles/${licensedFullTextArticleId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.analysisTextMode).toBe("licensed_full_text");
    expect(res.body.analysisText).toBe("Licensed body text Publisher A cleared for redistribution.");
  });

  it("withholds analysisText for an unclassified Publisher even in manual_fixture mode", async () => {
    const res = await request(app())
      .get(`/api/v1/articles/${fixtureTextWithheldArticleId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.analysisTextMode).toBe("manual_fixture");
    expect(res.body.analysisText).toBeNull();
  });

  it("serves text Tessera extracted itself once the Publisher is cleared (ADR-0032)", async () => {
    const res = await request(app())
      .get(`/api/v1/articles/${extractedTextArticleId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.analysisTextMode).toBe("api_content");
    expect(res.body.analysisText).toBe("Body text Tessera extracted from the page itself.");
  });

  it("returns 404 for a well-formed but unknown Article id", async () => {
    const res = await request(app())
      .get(`/api/v1/articles/${unknownArticleId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 rather than 500 for a malformed id", async () => {
    const res = await request(app()).get("/api/v1/articles/not-a-uuid").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// #64 — the timeline seam. Pure, and tested pure: it takes a *set of Articles* rather
// than a query precisely so the search timeline (#65) can hand it a set drawn from many
// Stories, and that contract is worth holding down without a database in the way.
function pointOf(id: string, publishedAt: string, storyId: string | null = "story-1"): TimelineArticle {
  return {
    id,
    storyId,
    title: `Article ${id}`,
    url: `https://publisher-a.example/${id}`,
    publishedAt: new Date(publishedAt),
    analysisTextMode: "manual_fixture",
    publisher: { id: "pub-1", name: "Publisher A", domain: "publisher-a.example" },
  };
}

describe("buildTimeline", () => {
  it("orders the reporting and echoes each point's Story, so a second consumer can lay out lanes", () => {
    const timeline = buildTimeline(
      [
        pointOf("c", "2026-01-03T00:00:00Z", "story-2"),
        pointOf("a", "2026-01-01T00:00:00Z", "story-1"),
        pointOf("b", "2026-01-02T00:00:00Z", "story-1"),
      ],
      [],
    );
    expect(timeline.points.map((point) => point.id)).toEqual(["a", "b", "c"]);
    expect(timeline.points.map((point) => point.storyId)).toEqual(["story-1", "story-1", "story-2"]);
  });

  it("counts reporting per period and keeps the periods with none", () => {
    const timeline = buildTimeline(
      [
        pointOf("a", "2026-01-01T01:00:00Z"),
        pointOf("b", "2026-01-01T20:00:00Z"),
        // Nothing on the 2nd or the 3rd: the lull is a fact about the Story.
        pointOf("c", "2026-01-04T09:00:00Z"),
      ],
      [],
    );
    expect(timeline.granularity).toBe("day");
    expect(timeline.volume).toEqual([
      { periodStart: new Date("2026-01-01T00:00:00Z"), count: 2 },
      { periodStart: new Date("2026-01-02T00:00:00Z"), count: 0 },
      { periodStart: new Date("2026-01-03T00:00:00Z"), count: 0 },
      { periodStart: new Date("2026-01-04T00:00:00Z"), count: 1 },
    ]);
  });

  it("buckets a short burst by the hour", () => {
    const timeline = buildTimeline(
      [pointOf("a", "2026-01-01T01:10:00Z"), pointOf("b", "2026-01-01T03:40:00Z")],
      [],
    );
    expect(timeline.granularity).toBe("hour");
    expect(timeline.volume.map((bucket) => bucket.count)).toEqual([1, 0, 1]);
  });

  it("coarsens the period rather than drawing more bars than can be read", () => {
    const timeline = buildTimeline(
      [pointOf("a", "2026-01-01T00:00:00Z"), pointOf("b", "2026-06-01T00:00:00Z")],
      [],
    );
    expect(timeline.granularity).toBe("week");
    expect(timeline.volume.length).toBeLessThanOrEqual(60);
    expect(timeline.volume.at(-1)!.count).toBe(1);
  });

  it("spans an analytical event that happened after the last Article", () => {
    const timeline = buildTimeline([pointOf("a", "2026-01-01T00:00:00Z")], [
      { kind: "analysis_completed", id: "run-1", at: new Date("2026-01-04T00:00:00Z"), lens: "student_context" },
    ]);
    expect(timeline.to).toEqual(new Date("2026-01-04T00:00:00Z"));
    expect(timeline.volume.map((bucket) => bucket.count)).toEqual([1, 0, 0, 0]);
  });

  // A merge (#52) moves a Story's members away and repoints its runs, so a Story
  // holding analytical events with no accepted reporting left is ordinary. The events
  // stay on the axis; the volume does not exist, because no reporting does — the drawn
  // overlay is guarded on exactly this being empty.
  it("spans the events but measures no volume for a set whose only marks are analytical", () => {
    const timeline = buildTimeline([], [
      { kind: "evidence_frozen", id: "set-1", at: new Date("2026-01-01T00:00:00Z"), articleCount: 4 },
      { kind: "analysis_completed", id: "run-1", at: new Date("2026-01-04T00:00:00Z"), lens: "student_context" },
    ]);
    expect(timeline.from).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(timeline.to).toEqual(new Date("2026-01-04T00:00:00Z"));
    expect(timeline.events.map((event) => event.id)).toEqual(["set-1", "run-1"]);
    expect(timeline.volume).toEqual([]);
  });

  it("returns an empty timeline, not a broken axis, for a Story with no datable reporting", () => {
    const timeline = buildTimeline([], []);
    expect(timeline).toMatchObject({ from: null, to: null, points: [], events: [], volume: [] });
  });
});

describe("GET /api/v1/stories/:id/timeline", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app()).get(`/api/v1/stories/${storyAlphaId}/timeline`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for a well-formed but unknown Story id", async () => {
    const res = await request(app())
      .get(`/api/v1/stories/${unknownStoryId}/timeline`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 rather than 500 for a malformed id", async () => {
    const res = await request(app()).get("/api/v1/stories/not-a-uuid/timeline").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("orders the Story's accepted reporting and leaves a pending proposal off the axis", async () => {
    const res = await request(app())
      .get(`/api/v1/stories/${timelineStoryId}/timeline`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.points.map((point: { title: string }) => point.title)).toEqual([
      "Timeline, first report",
      "Timeline, second report",
    ]);
    expect(res.body.points[0].publisher.name).toBe("Publisher A");
    expect(res.body.granularity).toBe("day");
    expect(res.body.volume.map((bucket: { count: number }) => bucket.count)).toEqual([1, 0, 0, 0, 1]);
  });

  it("carries the frozen evidence and the completed analysis, and not the failed one", async () => {
    const res = await request(app())
      .get(`/api/v1/stories/${timelineStoryId}/timeline`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.events).toEqual([
      {
        kind: "evidence_frozen",
        id: expect.any(String),
        at: "2026-02-05T06:00:00.000Z",
        articleCount: 2,
      },
      {
        kind: "analysis_completed",
        id: expect.any(String),
        at: "2026-02-05T07:00:00.000Z",
        lens: "student_context",
      },
    ]);
  });
});
