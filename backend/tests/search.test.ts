import "reflect-metadata";
import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { Publisher } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { Article } from "../src/entities/Article";
import { MockEmbeddingProvider } from "../src/embeddings/MockEmbeddingProvider";
import { toVectorLiteral } from "../src/embeddings/pgvector";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

const app = () => createApp();
const embedder = new MockEmbeddingProvider();

async function embedArticle(id: string, text: string): Promise<void> {
  const vector = await embedder.embed(text);
  await AppDataSource.query(`UPDATE "articles" SET "embedding" = $1::vector WHERE "id" = $2`, [
    toVectorLiteral(vector),
    id,
  ]);
}

let token: string;
let quantumArticleId: string;
let internalTextArticleId: string;
let marketsArticleId: string;
let nebulaArticleId: string;

beforeAll(async () => {
  const registerRes = await request(app())
    .post("/api/v1/auth/register")
    .send({ email: "search@example.com", password: "correct-horse", role: "student" });
  token = registerRes.body.token;

  const publishers = AppDataSource.getRepository(Publisher);
  const stories = AppDataSource.getRepository(Story);
  const articles = AppDataSource.getRepository(Article);

  const publisher = await publishers.save({ name: "Publisher A", domain: "publisher-a.example" });

  const storyTech = await stories.save({
    slug: "story-quantum",
    title: "Story Quantum",
    summary: "Quantum computing coverage.",
    category: "technology",
    firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-01-01T00:00:00Z"),
  });
  const quantumArticle = await articles.save({
    storyId: storyTech.id,
    publisherId: publisher.id,
    title: "Quantum computers reach a new milestone",
    url: "https://publisher-a.example/quantum",
    analysisText: "Researchers report a breakthrough in quantum computing error correction.",
    analysisTextType: "manual_fixture",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
  });
  quantumArticleId = quantumArticle.id;
  await embedArticle(quantumArticle.id, `${quantumArticle.title}\n${quantumArticle.analysisText}`);

  const internalTextArticle = await articles.save({
    storyId: storyTech.id,
    publisherId: publisher.id,
    title: "Quantum computing licensed deep-dive",
    url: "https://publisher-a.example/quantum-licensed",
    analysisText: "Licensed body text about quantum computing that must never leave the API.",
    analysisTextType: "api_content",
    publishedAt: new Date("2026-01-02T00:00:00Z"),
  });
  internalTextArticleId = internalTextArticle.id;
  await embedArticle(internalTextArticle.id, `${internalTextArticle.title}\n${internalTextArticle.analysisText}`);

  const storyBiz = await stories.save({
    slug: "story-markets",
    title: "Story Markets",
    summary: null,
    category: "business",
    firstSeenAt: new Date("2026-02-01T00:00:00Z"),
    lastSeenAt: new Date("2026-02-01T00:00:00Z"),
  });
  const marketsArticle = await articles.save({
    storyId: storyBiz.id,
    publisherId: publisher.id,
    title: "Markets rally on earnings",
    url: "https://publisher-a.example/markets",
    analysisText: "Stock markets rallied after strong quarterly earnings reports.",
    analysisTextType: "manual_fixture",
    publishedAt: new Date("2026-02-01T00:00:00Z"),
  });
  marketsArticleId = marketsArticle.id;
  await embedArticle(marketsArticle.id, `${marketsArticle.title}\n${marketsArticle.analysisText}`);

  // Story text carries a term absent from every one of its Articles, so a match
  // here only works if the lexical signal reads Story text too (ADR-0014).
  const storyNebula = await stories.save({
    slug: "story-nebula",
    title: "Story Nebula",
    summary: "Distant nebula imagery stuns astronomers.",
    category: "science",
    firstSeenAt: new Date("2026-03-01T00:00:00Z"),
    lastSeenAt: new Date("2026-03-01T00:00:00Z"),
  });
  const nebulaArticle = await articles.save({
    storyId: storyNebula.id,
    publisherId: publisher.id,
    title: "Space telescope captures new deep-field photo",
    url: "https://publisher-a.example/deep-field",
    analysisText: "The telescope captured unprecedented detail in a distant galaxy cluster.",
    analysisTextType: "manual_fixture",
    publishedAt: new Date("2026-03-01T00:00:00Z"),
  });
  nebulaArticleId = nebulaArticle.id;
  await embedArticle(nebulaArticle.id, `${nebulaArticle.title}\n${nebulaArticle.analysisText}`);
});

describe("GET /api/v1/search", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app()).get("/api/v1/search").query({ q: "quantum" });
    expect(res.status).toBe(401);
  });

  it("rejects a missing q with 422", async () => {
    const res = await request(app()).get("/api/v1/search").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it("rejects a blank q with 422", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "   " })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it("ranks a lexical match by relevance and includes a fused score", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((a: { id: string }) => a.id);
    expect(ids).toContain(quantumArticleId);
    expect(res.body.items[0]).toHaveProperty("score");
    // Fused results are sorted by score descending by default.
    const scores = res.body.items.map((a: { score: number }) => a.score);
    expect([...scores]).toEqual([...scores].sort((a, b) => b - a));
  });

  it("matches lexically on the parent Story's title/summary, not just the Article's own text (ADR-0014)", async () => {
    // "nebula" appears only in Story Nebula's summary — never in any Article's
    // own title/analysisText — so this only ranks first if the lexical signal
    // reads Story text too, not Article text alone.
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "nebula" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items[0].id).toBe(nebulaArticleId);
  });

  it("withholds analysisText for a mode we may not redistribute (ADR-0018)", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing licensed" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const licensed = res.body.items.find((a: { id: string }) => a.id === internalTextArticleId);
    expect(licensed).toBeDefined();
    expect(licensed.analysisTextType).toBe("api_content");
    expect(licensed.analysisText).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("must never leave the API");
  });

  it("filters by category", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing", category: "business" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((a: { id: string }) => a.id)).not.toContain(quantumArticleId);
  });

  it("rejects an unknown category with 422", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum", category: "not-a-real-category" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it("returns an empty envelope, not an error, when filters exclude every match", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing", category: "sports" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.totalPages).toBe(1);
  });

  it("filters by date range on publishedAt", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing", dateFrom: "2026-01-02", dateTo: "2026-01-02" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((a: { id: string }) => a.id)).toEqual([internalTextArticleId]);
  });

  it("rejects an inverted date range with 422", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum", dateFrom: "2026-01-04", dateTo: "2026-01-02" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it("sorts by publishedAt when asked, instead of relevance", async () => {
    // Mock embeddings give every embedded article some nonzero semantic score,
    // so every fixture is in the fused set for any query text here — this
    // asserts sort order, not which articles matched.
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum", sort: "publishedAt:asc" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((a: { id: string }) => a.id)).toEqual([
      quantumArticleId,
      internalTextArticleId,
      marketsArticleId,
      nebulaArticleId,
    ]);
  });

  it("rejects an unknown sort field with 422", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum", sort: "title:asc" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it("paginates the fused set with page/pageSize and reports total/totalPages", async () => {
    const page1 = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing markets earnings", pageSize: 1, page: 1, sort: "publishedAt:asc" })
      .set("Authorization", `Bearer ${token}`);
    const page2 = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing markets earnings", pageSize: 1, page: 2, sort: "publishedAt:asc" })
      .set("Authorization", `Bearer ${token}`);

    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(4);
    expect(page1.body.totalPages).toBe(4);
    expect(page1.body.items).toHaveLength(1);

    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
  });

  it("is deterministic across repeated identical requests", async () => {
    const first = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing markets earnings" })
      .set("Authorization", `Bearer ${token}`);
    const second = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing markets earnings" })
      .set("Authorization", `Bearer ${token}`);

    expect(first.body.items.map((a: { id: string }) => a.id)).toEqual(
      second.body.items.map((a: { id: string }) => a.id),
    );
  });
});
