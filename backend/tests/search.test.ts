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
import { hybridSearchArticleIds } from "../src/lib/hybridSearch";
import { buildTimeline, toLanes } from "../src/timeline/buildTimeline";
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
let semanticOnlyArticleId: string;

// The one query text whose vector is planted on a fixture below, so it lands at
// cosine distance 0 and the semantic branch is guaranteed to return it.
const SEMANTIC_QUERY = "quantum computing";

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
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisher.id,
    title: "Quantum computers reach a new milestone",
    url: "https://publisher-a.example/quantum",
    analysisText: "Researchers report a breakthrough in quantum computing error correction.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
  });
  quantumArticleId = quantumArticle.id;
  // Mock embeddings are a hash of the exact text (no semantic structure at all),
  // so any two different strings land ~orthogonal. Planting SEMANTIC_QUERY's own
  // vector here is how a fixture gets a *deliberate* semantic hit rather than
  // noise: this article matches SEMANTIC_QUERY on both signals.
  await embedArticle(quantumArticle.id, SEMANTIC_QUERY);

  const internalTextArticle = await articles.save({
    storyId: storyTech.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisher.id,
    title: "Quantum computing licensed deep-dive",
    url: "https://publisher-a.example/quantum-licensed",
    analysisText: "Licensed body text about quantum computing that must never leave the API.",
    analysisTextMode: "api_content",
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
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisher.id,
    title: "Markets rally on earnings",
    url: "https://publisher-a.example/markets",
    analysisText: "Stock markets rallied after strong quarterly earnings reports.",
    analysisTextMode: "manual_fixture",
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
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisher.id,
    title: "Space telescope captures new deep-field photo",
    url: "https://publisher-a.example/deep-field",
    analysisText: "The telescope captured unprecedented detail in a distant galaxy cluster.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-03-01T00:00:00Z"),
  });
  nebulaArticleId = nebulaArticle.id;
  await embedArticle(nebulaArticle.id, `${nebulaArticle.title}\n${nebulaArticle.analysisText}`);

  // Shares no term with SEMANTIC_QUERY — its own Story included — so it can
  // never match lexically, but carries that query's vector. The only way it
  // reaches a result set is through the semantic half of the fusion.
  const storyTrade = await stories.save({
    slug: "story-trade",
    title: "Story Trade",
    summary: "Tariff policy and supply chains.",
    category: "business",
    firstSeenAt: new Date("2026-04-01T00:00:00Z"),
    lastSeenAt: new Date("2026-04-01T00:00:00Z"),
  });
  const semanticOnlyArticle = await articles.save({
    storyId: storyTrade.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisher.id,
    title: "Supply chains adjust to new tariffs",
    url: "https://publisher-a.example/tariffs",
    analysisText: "Importers redraw logistics routes after the latest tariff schedule.",
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-04-01T00:00:00Z"),
  });
  semanticOnlyArticleId = semanticOnlyArticle.id;
  await embedArticle(semanticOnlyArticle.id, SEMANTIC_QUERY);
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

  it("serves no body text at all, for any mode (ADR-0018)", async () => {
    // Search is a list endpoint: /articles/:id stays the only one that serves
    // body text, so results carry the mode but never the text behind it — not
    // even for a mode we would be free to redistribute.
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum computing licensed" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const licensed = res.body.items.find((a: { id: string }) => a.id === internalTextArticleId);
    expect(licensed).toBeDefined();
    expect(licensed.analysisTextMode).toBe("api_content");
    expect(licensed).not.toHaveProperty("analysisText");
    expect(JSON.stringify(res.body)).not.toContain("must never leave the API");
    expect(JSON.stringify(res.body)).not.toContain("error correction");
  });

  it("fuses in a semantic-only hit that no lexical match could reach (ADR-0014)", async () => {
    // The tariffs fixture shares no term with the query, so tsquery cannot
    // return it; it carries the query's own vector, so ANN ranks it first.
    // Its presence is the semantic branch's contribution, made visible.
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: SEMANTIC_QUERY })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((a: { id: string }) => a.id);
    expect(ids).toContain(semanticOnlyArticleId);

    // And it is genuinely unreachable lexically: a query of its own words
    // brings it back, but SEMANTIC_QUERY appears nowhere in its text.
    const lexicalOnly = await request(app())
      .get("/api/v1/search")
      .query({ q: "tariffs logistics" })
      .set("Authorization", `Bearer ${token}`);
    expect(lexicalOnly.body.items.map((a: { id: string }) => a.id)).toEqual([semanticOnlyArticleId]);
  });

  it("scores a hit found by both signals above one found by either alone", async () => {
    // RRF is sum(1/(k+rank)): two signals contribute two terms, one contributes
    // one. quantumArticle matches SEMANTIC_QUERY lexically *and* carries its
    // vector; the tariffs fixture is semantic-only, so it must score lower.
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: SEMANTIC_QUERY })
      .set("Authorization", `Bearer ${token}`);

    const byId = new Map(res.body.items.map((a: { id: string; score: number }) => [a.id, a.score]));
    expect(byId.get(quantumArticleId)).toBeGreaterThan(byId.get(semanticOnlyArticleId) as number);
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

  it("returns an empty envelope when nothing matches the query text at all", async () => {
    // Neither signal fires: no lexical hit, and every embedding sits beyond the
    // semantic distance cutoff. Without that cutoff ANN would return its
    // nearest k regardless and this would come back with the whole corpus.
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "zzzzqqq nonexistentterm" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.totalPages).toBe(1);
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
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: SEMANTIC_QUERY, sort: "publishedAt:asc" })
      .set("Authorization", `Bearer ${token}`);

    // The tariffs fixture is here on the semantic signal alone, so this is the
    // sort applying to the *fused* set, not to the lexical hits it reorders.
    expect(res.status).toBe(200);
    expect(res.body.items.map((a: { id: string }) => a.id)).toEqual([
      quantumArticleId,
      internalTextArticleId,
      semanticOnlyArticleId,
    ]);
    expect(res.body.total).toBe(3);
  });

  it("rejects an unknown sort field with 422", async () => {
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: "quantum", sort: "title:asc" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it("paginates the fused set with page/pageSize and reports total/totalPages", async () => {
    // Fused set for SEMANTIC_QUERY: two lexical hits (quantum, licensed) union
    // two semantic hits (quantum, tariffs) — three distinct articles.
    const query = { q: SEMANTIC_QUERY, pageSize: 1, sort: "publishedAt:asc" };
    const page1 = await request(app())
      .get("/api/v1/search")
      .query({ ...query, page: 1 })
      .set("Authorization", `Bearer ${token}`);
    const page2 = await request(app())
      .get("/api/v1/search")
      .query({ ...query, page: 2 })
      .set("Authorization", `Bearer ${token}`);

    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(3);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.items).toHaveLength(1);

    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
  });

  it("still reports the true total on a page past the end", async () => {
    // The count has to survive an empty page: derived from the returned rows it
    // would read back as 0 here, and the UI would lose its pager.
    const res = await request(app())
      .get("/api/v1/search")
      .query({ q: SEMANTIC_QUERY, pageSize: 1, page: 99 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(3);
    expect(res.body.totalPages).toBe(3);
  });

  it("keeps Unclustered Articles from exhausting the semantic candidate pool", async () => {
    const publisher = await AppDataSource.getRepository(Publisher).findOneByOrFail({ domain: "publisher-a.example" });
    const story = await AppDataSource.getRepository(Story).save({
      slug: "story-ann-pool",
      title: "Visible semantic target",
      summary: null,
      category: "technology",
      firstSeenAt: new Date("2026-05-01T00:00:00Z"),
      lastSeenAt: new Date("2026-05-01T00:00:00Z"),
    });
    const target = await AppDataSource.getRepository(Article).save({
      storyId: story.id,
      storyAssignmentStatus: "auto_accepted" as const,
      publisherId: publisher.id,
      title: "Visible target",
      url: "https://publisher-a.example/visible-pool-target",
      analysisText: "No lexical overlap with the pool query.",
      analysisTextMode: "feed_excerpt",
      publishedAt: new Date("2026-05-01T00:00:00Z"),
    });
    const queryVector = new Array<number>(1024).fill(0);
    queryVector[0] = 1;
    const targetVector = [...queryVector];
    targetVector[0] = Math.cos(0.1);
    targetVector[1] = Math.sin(0.1);
    await AppDataSource.query(`UPDATE "articles" SET "embedding" = $1::vector WHERE "id" = $2`, [
      toVectorLiteral(targetVector),
      target.id,
    ]);
    await AppDataSource.query(
      `INSERT INTO "articles" ("publisherId", "title", "url", "analysisText", "analysisTextMode", "publishedAt", "embedding")
       SELECT $1, 'pool noise ' || n, 'https://pool-noise-' || n || '.example/article',
              'unclustered noise', 'feed_excerpt', NOW(), $2::vector
       FROM generate_series(1, 501) n`,
      [publisher.id, toVectorLiteral(queryVector)],
    );

    let result;
    try {
      result = await hybridSearchArticleIds(
        "unique semantic pool query",
        {
          page: 1,
          pageSize: 20,
          sortBy: "relevance",
          sortDir: "desc",
          category: undefined,
          dateFrom: undefined,
          dateTo: undefined,
        },
        { embed: async () => queryVector, embedBatch: async () => [queryVector] },
      );
    } finally {
      await AppDataSource.query(`DELETE FROM "articles" WHERE "url" LIKE 'https://pool-noise-%'`);
      await AppDataSource.getRepository(Article).delete(target.id);
      await AppDataSource.getRepository(Story).delete(story.id);
    }

    expect(result.hits.map((hit) => hit.id)).toContain(target.id);
  });

  // ADR-0023: the hosted provider is a network dependency, so an outage or a 429
  // has to cost the semantic signal rather than the request.
  it("degrades to lexical-only results when the embedding provider fails", async () => {
    const failing = {
      embed: () => Promise.reject(new Error("429 rate limited")),
      embedBatch: () => Promise.reject(new Error("429 rate limited")),
    };
    const filters = {
      page: 1,
      pageSize: 20,
      sortBy: "relevance" as const,
      sortDir: "desc" as const,
      category: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    };

    const degraded = await hybridSearchArticleIds(SEMANTIC_QUERY, filters, failing);
    const ids = degraded.hits.map((hit) => hit.id);

    // Lexical still answers: the query's own words are in quantumArticle's text.
    expect(ids).toContain(quantumArticleId);
    // But the article only the vector branch could reach is now unreachable —
    // which is exactly the signal that was lost, and nothing else.
    expect(ids).not.toContain(semanticOnlyArticleId);

    const healthy = await hybridSearchArticleIds(SEMANTIC_QUERY, filters, embedder);
    expect(healthy.hits.map((hit) => hit.id)).toContain(semanticOnlyArticleId);
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

// #65 — lanes over an assembled Timeline. Pure, so the property that matters is held
// down without a database in the way: every lane draws against the *shared* axis, which
// is the whole reason parallel coverage reads as parallel.
function pointOf(id: string, publishedAt: string, storyId: string | null) {
  return {
    id,
    storyId,
    title: `Article ${id}`,
    url: `https://publisher-a.example/${id}`,
    publishedAt: new Date(publishedAt),
    analysisTextMode: "manual_fixture" as const,
    publisher: { id: "pub-1", name: "Publisher A", domain: "publisher-a.example" },
  };
}

describe("toLanes", () => {
  it("buckets each Story against the shared axis, so overlapping coverage lands in one column", () => {
    const timeline = buildTimeline(
      [
        pointOf("a", "2026-01-01T00:00:00Z", "story-1"),
        pointOf("b", "2026-01-02T00:00:00Z", "story-1"),
        pointOf("c", "2026-01-02T00:00:00Z", "story-2"),
        pointOf("d", "2026-01-04T00:00:00Z", "story-2"),
      ],
      [],
    );
    const lanes = toLanes(timeline);

    // Both lanes span the whole axis, four buckets wide, and both report on the 2nd —
    // the same index in each. A per-lane axis would have given story-2 three buckets
    // starting at its own first report, and the overlap would be invisible.
    expect(lanes).toEqual([
      { storyId: "story-1", volume: [1, 1, 0, 0] },
      { storyId: "story-2", volume: [0, 1, 0, 1] },
    ]);
    expect(lanes.every((lane) => lane.volume.length === timeline.volume.length)).toBe(true);
  });

  it("orders the lanes by when each Story's coverage began", () => {
    const timeline = buildTimeline(
      [
        pointOf("late", "2026-01-03T00:00:00Z", "story-late"),
        pointOf("early", "2026-01-01T00:00:00Z", "story-early"),
      ],
      [],
    );
    expect(toLanes(timeline).map((lane) => lane.storyId)).toEqual(["story-early", "story-late"]);
  });

  it("leaves an Article in no Story out of the lanes rather than inventing one", () => {
    const timeline = buildTimeline(
      [pointOf("a", "2026-01-01T00:00:00Z", "story-1"), pointOf("loose", "2026-01-02T00:00:00Z", null)],
      [],
    );
    expect(toLanes(timeline).map((lane) => lane.storyId)).toEqual(["story-1"]);
  });

  it("has no lanes for a set with nothing in it", () => {
    expect(toLanes(buildTimeline([], []))).toEqual([]);
  });

  it("has no lanes for a set whose only marks are analytical events", () => {
    // The axis exists but carries no reporting, so `volume` is empty and there is no origin
    // to bucket against. The one shape where a fallback origin would have bucketed against
    // the epoch instead of saying there is nothing to lay out.
    const timeline = buildTimeline([], [
      { kind: "evidence_frozen", id: "e1", at: new Date("2026-01-01T00:00:00Z"), articleCount: 3 },
    ]);
    expect(timeline.volume).toEqual([]);
    expect(toLanes(timeline)).toEqual([]);
  });
});

describe("GET /api/v1/search/timeline", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app()).get("/api/v1/search/timeline").query({ q: "quantum" });
    expect(res.status).toBe(401);
  });

  it("rejects a blank q with 422", async () => {
    const res = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: "  " })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
  });

  it("lays the matching reporting on one axis, ordered", async () => {
    const res = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: SEMANTIC_QUERY })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.points.map((point: { id: string }) => point.id)).toEqual([
      quantumArticleId,
      internalTextArticleId,
      semanticOnlyArticleId,
    ]);
    expect(res.body.from).toBe("2026-01-01T00:00:00.000Z");
    expect(res.body.to).toBe("2026-04-01T00:00:00.000Z");
    // No analytical events on this axis: they belong to a Story's own history (#64).
    expect(res.body.events).toEqual([]);
  });

  it("ranks with the search endpoint's relevance rather than a second implementation", async () => {
    // The acceptance criterion behind the reuse: one relevance implementation, so the two
    // surfaces cannot disagree about what matched. What they agree on is the match set and
    // its ranking — `total` here is the same count over the same filters. The *rendered*
    // sets coincide only up to a page: a list page holds at most MAX_PAGE_SIZE and the axis
    // up to TIMELINE_MATCH_CAP, so a page of the list is a subset of the axis, never the
    // other way round. This corpus is smaller than either, so here they are equal too.
    const list = await request(app())
      .get("/api/v1/search")
      .query({ q: SEMANTIC_QUERY, pageSize: 50 })
      .set("Authorization", `Bearer ${token}`);
    const timeline = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: SEMANTIC_QUERY })
      .set("Authorization", `Bearer ${token}`);

    expect(timeline.status).toBe(200);
    expect(list.body.items).toHaveLength(3);
    const onAxis = timeline.body.points.map((p: { id: string }) => p.id);
    const listed = list.body.items.map((a: { id: string }) => a.id);
    expect(listed.every((id: string) => onAxis.includes(id))).toBe(true);
    expect(onAxis.slice().sort()).toEqual(listed.slice().sort());
    expect(timeline.body.total).toBe(list.body.total);
  });

  it("groups the matches into one lane per Story, each naming the Story it routes into", async () => {
    const res = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: SEMANTIC_QUERY })
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.lanes).toHaveLength(2);
    expect(res.body.lanes.map((lane: { story: { slug: string } }) => lane.story.slug)).toEqual([
      "story-quantum",
      "story-trade",
    ]);
    // The same Story projection a result row carries — id, slug and title, nothing the
    // Story's own record page is for.
    expect(res.body.lanes[0].story).toEqual({
      id: expect.any(String),
      slug: "story-quantum",
      title: "Story Quantum",
    });
    // Every lane is drawn against the axis' own buckets, which is what makes two
    // Stories' coverage comparable on one page.
    for (const lane of res.body.lanes) {
      expect(lane.volume).toHaveLength(res.body.volume.length);
    }
    expect(res.body.lanes[0].volume.reduce((sum: number, n: number) => sum + n, 0)).toBe(2);
  });

  it("shows only accepted Story Assignment members", async () => {
    const publisher = await AppDataSource.getRepository(Publisher).findOneByOrFail({
      domain: "publisher-a.example",
    });
    const story = await AppDataSource.getRepository(Story).save({
      slug: "story-timeline-pending",
      title: "Timeline pending",
      summary: "Zeppelin coverage under review.",
      category: "world",
      firstSeenAt: new Date("2026-06-01T00:00:00Z"),
      lastSeenAt: new Date("2026-06-01T00:00:00Z"),
    });
    const proposed = await AppDataSource.getRepository(Article).save({
      storyId: story.id,
      // A proposal carries the Story's id but is not part of it until an Admin says so.
      storyAssignmentStatus: "pending_review" as const,
      publisherId: publisher.id,
      title: "Zeppelin, merely proposed",
      url: "https://publisher-a.example/zeppelin-proposed",
      analysisText: "A zeppelin proposal awaiting review.",
      analysisTextMode: "manual_fixture" as const,
      publishedAt: new Date("2026-06-01T00:00:00Z"),
    });

    try {
      const res = await request(app())
        .get("/api/v1/search/timeline")
        // The one term in the corpus that appears nowhere but this proposal and its
        // Story, so a hit here could only be the proposal itself.
        .query({ q: "zeppelin" })
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.points).toEqual([]);
      expect(res.body.lanes).toEqual([]);
    } finally {
      await AppDataSource.getRepository(Article).delete(proposed.id);
      await AppDataSource.getRepository(Story).delete(story.id);
    }
  });

  it("narrows the axis by date range", async () => {
    const res = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: SEMANTIC_QUERY, dateFrom: "2026-01-02", dateTo: "2026-01-02" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.points.map((p: { id: string }) => p.id)).toEqual([internalTextArticleId]);
    expect(res.body.lanes).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it("returns an empty axis, not an error, when nothing matched", async () => {
    const res = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: "zzzzqqq nonexistentterm" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: null, to: null, points: [], lanes: [], volume: [], total: 0 });
  });

  it("accepts the list endpoint's whole vocabulary rather than dead-ending a switched URL", async () => {
    // Everything /search puts in the address bar crosses when a reader switches readings,
    // `page` and `pageSize` included — the page hands its query string over whole, so a 422
    // here would be a reader losing their query for having turned a page first.
    const res = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: SEMANTIC_QUERY, sort: "publishedAt:asc", page: 3, pageSize: 50 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Accepted and ignored: the axis is a set, so it has no page 3 to turn to, and it is
    // pinned to relevance, so a carried `sort` cannot change which matches it holds.
    const plain = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: SEMANTIC_QUERY })
      .set("Authorization", `Bearer ${token}`);
    expect(res.body).toEqual(plain.body);
    // Still time-ordered: an axis has one order, whatever the sort asked for.
    expect(res.body.points.map((p: { id: string }) => p.id)).toEqual([
      quantumArticleId,
      internalTextArticleId,
      semanticOnlyArticleId,
    ]);
  });

  it("rejects a pageSize past its own cap, and the list's past the list's", async () => {
    // The cap is the bound this route validates against, not a number written past the
    // shared parse — so the ceiling is stated in one place per route rather than two.
    const overCap = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: SEMANTIC_QUERY, pageSize: 201 })
      .set("Authorization", `Bearer ${token}`);
    expect(overCap.status).toBe(422);

    const atCap = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: SEMANTIC_QUERY, pageSize: 200 })
      .set("Authorization", `Bearer ${token}`);
    expect(atCap.status).toBe(200);

    // A paginated list keeps the smaller shared bound: the axis reads more because it
    // cannot page, which is not licence for a page to.
    const list = await request(app())
      .get("/api/v1/search")
      .query({ q: SEMANTIC_QUERY, pageSize: 200 })
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(422);
  });

  it("serves no body text, exactly as the result list does not (ADR-0018)", async () => {
    const res = await request(app())
      .get("/api/v1/search/timeline")
      .query({ q: "quantum computing licensed" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.points.map((p: { id: string }) => p.id)).toContain(internalTextArticleId);
    expect(JSON.stringify(res.body)).not.toContain("must never leave the API");
    expect(JSON.stringify(res.body)).not.toContain("error correction");
  });
});
