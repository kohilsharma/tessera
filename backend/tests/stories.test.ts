import "reflect-metadata";
import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { Publisher } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { Article } from "../src/entities/Article";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

const app = () => createApp();

const unknownStoryId = "00000000-0000-0000-0000-000000000000";
const unknownArticleId = "00000000-0000-0000-0000-000000000000";

let token: string;
let storyAlphaId: string;
let articleAlphaOneId: string;
let internalTextArticleId: string;
let tiedStoryIds: string[];

beforeAll(async () => {
  const registerRes = await request(app())
    .post("/api/v1/auth/register")
    .send({ email: "browse@example.com", password: "correct-horse", role: "student" });
  token = registerRes.body.token;

  const publishers = AppDataSource.getRepository(Publisher);
  const stories = AppDataSource.getRepository(Story);
  const articles = AppDataSource.getRepository(Article);

  const publisherA = await publishers.save({ name: "Publisher A", domain: "publisher-a.example" });
  const publisherB = await publishers.save({ name: "Publisher B", domain: "publisher-b.example" });

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
    publisherId: publisherA.id,
    title: "Alpha, from Publisher A",
    url: "https://publisher-a.example/alpha",
    analysisText: "Alpha coverage from Publisher A.",
    analysisTextType: "manual_fixture",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
  });
  articleAlphaOneId = articleAlphaOne.id;
  await articles.save({
    storyId: storyAlpha.id,
    publisherId: publisherB.id,
    title: "Alpha, from Publisher B",
    url: "https://publisher-b.example/alpha",
    analysisText: "Alpha coverage from Publisher B.",
    analysisTextType: "manual_fixture",
    publishedAt: new Date("2026-01-01T12:00:00Z"),
  });

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
    publisherId: publisherA.id,
    title: "Beta, from Publisher A",
    url: "https://publisher-a.example/beta",
    analysisText: "Beta coverage.",
    analysisTextType: "manual_fixture",
    publishedAt: new Date("2026-01-03T00:00:00Z"),
  });
  // A body we hold for analysis but may not redistribute (ADR-0018).
  const internalTextArticle = await articles.save({
    storyId: storyBeta.id,
    publisherId: publisherB.id,
    title: "Beta, from Publisher B",
    url: "https://publisher-b.example/beta",
    analysisText: "Licensed body text that must never leave the API.",
    analysisTextType: "api_content",
    publishedAt: new Date("2026-01-03T06:00:00Z"),
  });
  internalTextArticleId = internalTextArticle.id;

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
    publisherId: publisherA.id,
    title: "Gamma, from Publisher A",
    url: "https://publisher-a.example/gamma",
    analysisText: "Gamma coverage.",
    analysisTextType: "manual_fixture",
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
    publisherId: publisherA.id,
    title: "Delta, from Publisher A",
    url: "https://publisher-a.example/delta",
    analysisText: "Delta coverage.",
    analysisTextType: "manual_fixture",
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
    publisherId: publisherA.id,
    title: "Echo, from Publisher A",
    url: "https://publisher-a.example/echo",
    analysisText: "Echo coverage.",
    analysisTextType: "manual_fixture",
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
      publisherId: publisherA.id,
      title: `Tied ${suffix}, from Publisher A`,
      url: `https://publisher-a.example/tied-${suffix.toLowerCase()}`,
      analysisText: `Tied ${suffix} coverage.`,
      analysisTextType: "manual_fixture",
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
    publisherId: publisherA.id,
    title: "Late In Day, from Publisher A",
    url: "https://publisher-a.example/late-in-day",
    analysisText: "Late-in-day coverage.",
    analysisTextType: "manual_fixture",
    publishedAt: new Date("2025-11-15T18:30:00Z"),
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
    expect(res.body.items.slice(0, 5).map((s: { title: string }) => s.title)).toEqual([
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
    expect(page1.body).toMatchObject({ page: 1, pageSize: 2, total: 11, totalPages: 6 });
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

  it("withholds analysisText for a mode we may not redistribute (ADR-0018)", async () => {
    const res = await request(app())
      .get(`/api/v1/articles/${internalTextArticleId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.analysisTextType).toBe("api_content");
    expect(res.body.analysisText).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("must never leave the API");
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
