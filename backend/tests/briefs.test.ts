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

const unknownBriefId = "00000000-0000-0000-0000-000000000000";

async function registerAndLogin(email: string, role: "student" | "investor" = "student"): Promise<string> {
  const res = await request(app()).post("/api/v1/auth/register").send({ email, password: "correct-horse", role });
  return res.body.token as string;
}

let articleOneId: string;
let articleTwoId: string;
const concurrentArticleIds: string[] = [];

beforeAll(async () => {
  const publisher = await AppDataSource.getRepository(Publisher).save({
    name: "Briefs Publisher",
    domain: "briefs-publisher.example",
  });
  const story = await AppDataSource.getRepository(Story).save({
    slug: "briefs-story",
    title: "Briefs Story",
    summary: null,
    category: "technology",
    firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-01-01T00:00:00Z"),
  });
  const articles = AppDataSource.getRepository(Article);
  const articleOne = await articles.save({
    storyId: story.id,
    publisherId: publisher.id,
    title: "Briefs Article One",
    url: "https://briefs-publisher.example/one",
    analysisText: "One.",
    analysisTextType: "manual_fixture",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
  });
  articleOneId = articleOne.id;
  const articleTwo = await articles.save({
    storyId: story.id,
    publisherId: publisher.id,
    title: "Briefs Article Two",
    url: "https://briefs-publisher.example/two",
    analysisText: "Two.",
    analysisTextType: "manual_fixture",
    publishedAt: new Date("2026-01-01T01:00:00Z"),
  });
  articleTwoId = articleTwo.id;
  for (let index = 0; index < 8; index += 1) {
    const article = await articles.save({
      storyId: story.id,
      publisherId: publisher.id,
      title: `Concurrent Briefs Article ${index}`,
      url: `https://briefs-publisher.example/concurrent-${index}`,
      analysisText: `${index}.`,
      analysisTextType: "manual_fixture",
      publishedAt: new Date(`2026-01-02T0${index}:00:00Z`),
    });
    concurrentArticleIds.push(article.id);
  }
});

describe("POST /api/v1/briefs", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app()).post("/api/v1/briefs").send({ title: "x", category: "technology" });
    expect(res.status).toBe(401);
  });

  it("creates a Brief owned by the caller, defaulting note and capacity", async () => {
    const token = await registerAndLogin("brief-create@example.com");
    const res = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "My Brief", category: "technology" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "My Brief",
      note: null,
      category: "technology",
      articleCapacityLimit: 20,
      articleCount: 0,
    });
  });

  it("rejects a missing title with 422", async () => {
    const token = await registerAndLogin("brief-no-title@example.com");
    const res = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "technology" });
    expect(res.status).toBe(422);
  });

  it("rejects an unknown category with 422", async () => {
    const token = await registerAndLogin("brief-bad-category@example.com");
    const res = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "x", category: "not-a-real-category" });
    expect(res.status).toBe(422);
  });

  it("rejects a non-positive articleCapacityLimit with 422", async () => {
    const token = await registerAndLogin("brief-bad-capacity@example.com");
    const res = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "x", category: "technology", articleCapacityLimit: 0 });
    expect(res.status).toBe(422);
  });

  it("rejects a non-number articleCapacityLimit with 422", async () => {
    const token = await registerAndLogin("brief-non-number-capacity@example.com");
    const res = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "x", category: "technology", articleCapacityLimit: true });
    expect(res.status).toBe(422);
  });
});

describe("Brief ownership and lifecycle", () => {
  it("blocks reading, updating, and deleting a Brief owned by someone else with 403; 404 for an unknown Brief", async () => {
    const ownerToken = await registerAndLogin("brief-owner@example.com");
    const otherToken = await registerAndLogin("brief-other@example.com", "investor");

    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Owned Brief", category: "business" });
    const briefId = created.body.id;

    const readByOther = await request(app())
      .get(`/api/v1/briefs/${briefId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(readByOther.status).toBe(403);

    const updateByOther = await request(app())
      .patch(`/api/v1/briefs/${briefId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ title: "Hijacked" });
    expect(updateByOther.status).toBe(403);

    const deleteByOther = await request(app())
      .delete(`/api/v1/briefs/${briefId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(deleteByOther.status).toBe(403);

    const readUnknown = await request(app())
      .get(`/api/v1/briefs/${unknownBriefId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(readUnknown.status).toBe(404);

    const readMalformed = await request(app())
      .get("/api/v1/briefs/not-a-uuid")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(readMalformed.status).toBe(404);
  });

  it("lets the owner read, update, and delete their own Brief", async () => {
    const token = await registerAndLogin("brief-crud@example.com");
    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "CRUD Brief", note: "initial note", category: "science" });
    const briefId = created.body.id;

    const read = await request(app()).get(`/api/v1/briefs/${briefId}`).set("Authorization", `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ title: "CRUD Brief", note: "initial note", articles: [] });

    const updated = await request(app())
      .patch(`/api/v1/briefs/${briefId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "CRUD Brief Renamed", note: null });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ title: "CRUD Brief Renamed", note: null });

    const deleted = await request(app()).delete(`/api/v1/briefs/${briefId}`).set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(204);

    const readAfterDelete = await request(app())
      .get(`/api/v1/briefs/${briefId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(readAfterDelete.status).toBe(404);
  });

  it("treats an empty-body PATCH as a no-op rather than a 500", async () => {
    const token = await registerAndLogin("brief-empty-patch@example.com");
    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Untouched Brief", category: "world" });

    const res = await request(app())
      .patch(`/api/v1/briefs/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Untouched Brief", category: "world" });
  });

  it("only lists the caller's own Briefs", async () => {
    const tokenA = await registerAndLogin("brief-list-a@example.com");
    const tokenB = await registerAndLogin("brief-list-b@example.com", "investor");

    await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ title: "A's Brief", category: "world" });
    await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ title: "B's Brief", category: "world" });

    const listA = await request(app()).get("/api/v1/briefs").set("Authorization", `Bearer ${tokenA}`);
    expect(listA.status).toBe(200);
    expect(listA.body.items.map((b: { title: string }) => b.title)).toEqual(["A's Brief"]);
  });
});

describe("Brief article attachment and capacity", () => {
  it("attaches an Article, rejects duplicates and unknown ids, and reports articleCount", async () => {
    const token = await registerAndLogin("brief-attach@example.com");
    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Attach Brief", category: "technology" });
    const briefId = created.body.id;

    const attach = await request(app())
      .post(`/api/v1/briefs/${briefId}/articles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleId: articleOneId });
    expect(attach.status).toBe(201);

    const duplicate = await request(app())
      .post(`/api/v1/briefs/${briefId}/articles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleId: articleOneId });
    expect(duplicate.status).toBe(422);

    const unknownArticle = await request(app())
      .post(`/api/v1/briefs/${briefId}/articles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleId: unknownBriefId });
    expect(unknownArticle.status).toBe(422);

    const detail = await request(app()).get(`/api/v1/briefs/${briefId}`).set("Authorization", `Bearer ${token}`);
    expect(detail.body.articleCount).toBe(1);
    expect(detail.body.articles.map((a: { id: string }) => a.id)).toEqual([articleOneId]);
  });

  it("rejects attaching past articleCapacityLimit with 422", async () => {
    const token = await registerAndLogin("brief-capacity@example.com");
    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Capacity Brief", category: "technology", articleCapacityLimit: 1 });
    const briefId = created.body.id;

    const first = await request(app())
      .post(`/api/v1/briefs/${briefId}/articles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleId: articleOneId });
    expect(first.status).toBe(201);

    const second = await request(app())
      .post(`/api/v1/briefs/${briefId}/articles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleId: articleTwoId });
    expect(second.status).toBe(422);
  });

  it("serializes concurrent attachments at articleCapacityLimit", async () => {
    const token = await registerAndLogin("brief-concurrent-capacity@example.com");
    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Concurrent Capacity Brief", category: "technology", articleCapacityLimit: 1 });
    const briefId = created.body.id;

    const responses = await Promise.all(
      [articleOneId, articleTwoId, ...concurrentArticleIds].map((articleId) =>
        request(app())
          .post(`/api/v1/briefs/${briefId}/articles`)
          .set("Authorization", `Bearer ${token}`)
          .send({ articleId }),
      ),
    );

    expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 422)).toHaveLength(9);
    const detail = await request(app()).get(`/api/v1/briefs/${briefId}`).set("Authorization", `Bearer ${token}`);
    expect(detail.body.articleCount).toBe(1);
  });

  it("blocks attaching to a Brief owned by someone else with 403", async () => {
    const ownerToken = await registerAndLogin("brief-attach-owner@example.com");
    const otherToken = await registerAndLogin("brief-attach-other@example.com", "investor");
    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Not Yours", category: "technology" });

    const res = await request(app())
      .post(`/api/v1/briefs/${created.body.id}/articles`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ articleId: articleOneId });
    expect(res.status).toBe(403);
  });

  it("detaches an Article, freeing capacity", async () => {
    const token = await registerAndLogin("brief-detach@example.com");
    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Detach Brief", category: "technology", articleCapacityLimit: 1 });
    const briefId = created.body.id;

    await request(app())
      .post(`/api/v1/briefs/${briefId}/articles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleId: articleOneId });

    const detach = await request(app())
      .delete(`/api/v1/briefs/${briefId}/articles/${articleOneId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detach.status).toBe(204);

    const reattach = await request(app())
      .post(`/api/v1/briefs/${briefId}/articles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleId: articleTwoId });
    expect(reattach.status).toBe(201);
  });

  it("rejects lowering articleCapacityLimit below the number of attached Articles", async () => {
    const token = await registerAndLogin("brief-lower-capacity@example.com");
    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Lower Capacity Brief", category: "technology", articleCapacityLimit: 5 });
    const briefId = created.body.id;

    await request(app())
      .post(`/api/v1/briefs/${briefId}/articles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleId: articleOneId });

    await request(app())
      .post(`/api/v1/briefs/${briefId}/articles`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleId: articleTwoId });

    const res = await request(app())
      .patch(`/api/v1/briefs/${briefId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ articleCapacityLimit: 1 });
    expect(res.status).toBe(422);
  });
});

// 68-byte 1x1 transparent PNG: real magic bytes, small enough to hardcode.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("POST /api/v1/briefs/:id/cover-image", () => {
  async function createBrief(token: string, title: string): Promise<string> {
    const created = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title, category: "technology" });
    return created.body.id;
  }

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app())
      .post(`/api/v1/briefs/${unknownBriefId}/cover-image`)
      .attach("coverImage", TINY_PNG, { filename: "cover.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("blocks uploading a cover image to a Brief owned by someone else with 403", async () => {
    const ownerToken = await registerAndLogin("brief-cover-owner@example.com");
    const otherToken = await registerAndLogin("brief-cover-other@example.com", "investor");
    const briefId = await createBrief(ownerToken, "Cover Owner Brief");

    const res = await request(app())
      .post(`/api/v1/briefs/${briefId}/cover-image`)
      .set("Authorization", `Bearer ${otherToken}`)
      .attach("coverImage", TINY_PNG, { filename: "cover.png", contentType: "image/png" });
    expect(res.status).toBe(403);
  });

  it("stores a valid PNG and serves it back through coverImageUrl", async () => {
    const token = await registerAndLogin("brief-cover-success@example.com");
    const briefId = await createBrief(token, "Cover Success Brief");

    const res = await request(app())
      .post(`/api/v1/briefs/${briefId}/cover-image`)
      .set("Authorization", `Bearer ${token}`)
      .attach("coverImage", TINY_PNG, { filename: "cover.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.coverImageKey).toMatch(/\.png$/);
    expect(res.body.coverImageUrl).toBe(`/api/v1/media/${res.body.coverImageKey}`);

    const served = await request(app()).get(res.body.coverImageUrl);
    expect(served.status).toBe(200);
    expect(served.body).toEqual(TINY_PNG);
  });

  it("deletes the previous file when a cover image is replaced", async () => {
    const token = await registerAndLogin("brief-cover-replace@example.com");
    const briefId = await createBrief(token, "Cover Replace Brief");

    const first = await request(app())
      .post(`/api/v1/briefs/${briefId}/cover-image`)
      .set("Authorization", `Bearer ${token}`)
      .attach("coverImage", TINY_PNG, { filename: "cover.png", contentType: "image/png" });
    const firstUrl = first.body.coverImageUrl as string;

    const second = await request(app())
      .post(`/api/v1/briefs/${briefId}/cover-image`)
      .set("Authorization", `Bearer ${token}`)
      .attach("coverImage", TINY_PNG, { filename: "cover.png", contentType: "image/png" });
    expect(second.body.coverImageUrl).not.toBe(firstUrl);

    const oldFile = await request(app()).get(firstUrl);
    expect(oldFile.status).toBe(404);

    const newFile = await request(app()).get(second.body.coverImageUrl);
    expect(newFile.status).toBe(200);
  });

  it("rejects a file over the 2 MB limit with 422", async () => {
    const token = await registerAndLogin("brief-cover-oversized@example.com");
    const briefId = await createBrief(token, "Cover Oversized Brief");

    const oversized = Buffer.concat([TINY_PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await request(app())
      .post(`/api/v1/briefs/${briefId}/cover-image`)
      .set("Authorization", `Bearer ${token}`)
      .attach("coverImage", oversized, { filename: "cover.png", contentType: "image/png" });
    expect(res.status).toBe(422);
  });

  it("rejects a disallowed content type with 422", async () => {
    const token = await registerAndLogin("brief-cover-bad-type@example.com");
    const briefId = await createBrief(token, "Cover Bad Type Brief");

    const res = await request(app())
      .post(`/api/v1/briefs/${briefId}/cover-image`)
      .set("Authorization", `Bearer ${token}`)
      .attach("coverImage", Buffer.from("not an image"), { filename: "cover.txt", contentType: "text/plain" });
    expect(res.status).toBe(422);
  });

  it("rejects bytes that are not really an image even with an image/png Content-Type", async () => {
    const token = await registerAndLogin("brief-cover-fake-png@example.com");
    const briefId = await createBrief(token, "Cover Fake PNG Brief");

    const res = await request(app())
      .post(`/api/v1/briefs/${briefId}/cover-image`)
      .set("Authorization", `Bearer ${token}`)
      .attach("coverImage", Buffer.from("not actually a png"), { filename: "cover.png", contentType: "image/png" });
    expect(res.status).toBe(422);
  });
});
