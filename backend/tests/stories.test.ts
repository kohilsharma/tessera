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
      .query({ sortBy: "title", sortDir: "asc", pageSize: 50 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { title: string }) => s.title)).toEqual([
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
    expect(res.body.items.map((s: { title: string }) => s.title)).toEqual([
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
      .query({ pageSize: 2, page: 1, sortBy: "title", sortDir: "asc" })
      .set("Authorization", `Bearer ${token}`);
    const page2 = await request(app())
      .get("/api/v1/stories")
      .query({ pageSize: 2, page: 2, sortBy: "title", sortDir: "asc" })
      .set("Authorization", `Bearer ${token}`);

    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect(page1.body.items.map((s: { title: string }) => s.title)).toEqual(["Story Alpha", "Story Beta"]);

    expect(page2.status).toBe(200);
    expect(page2.body.items.map((s: { title: string }) => s.title)).toEqual(["Story Delta", "Story Echo"]);
  });

  it("filters by date range on firstSeenAt", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ from: "2026-01-02T00:00:00Z", to: "2026-01-04T00:00:00Z", sortBy: "title", sortDir: "asc" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { title: string }) => s.title)).toEqual([
      "Story Beta",
      "Story Echo",
      "Story Gamma",
    ]);
  });

  it("reports articleCount per Story in the list", async () => {
    const res = await request(app())
      .get("/api/v1/stories")
      .query({ category: "technology", sortBy: "title", sortDir: "asc" })
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
