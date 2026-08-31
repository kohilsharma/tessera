import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { signToken } from "../src/auth/jwt";
import { runClusteringJob } from "../src/clustering/jobs";
import { CLUSTERING_RUN_JOB, CLUSTERING_TICK_JOB } from "../src/clustering/queue";
import { runClustering } from "../src/clustering/runClustering";
import {
  DEFAULT_STORY_CATEGORY,
  EMBED_BATCH_SIZE,
  RECENCY_WINDOW_HOURS,
  REVIEW_THRESHOLD,
  SIMILARITY_THRESHOLD,
  STORY_NAMING_TIMEOUT_MS,
} from "../src/clustering/config";
import { decidePendingAssignment } from "../src/clustering/review";
import { EMBEDDING_DIMENSIONS, type EmbeddingKind, type EmbeddingProvider } from "../src/embeddings/EmbeddingProvider";
import { toVectorLiteral } from "../src/embeddings/pgvector";
import { Article, type AnalysisTextMode, type StoryAssignmentStatus } from "../src/entities/Article";
import { ClusteringRun } from "../src/entities/ClusteringRun";
import { IngestionConnector } from "../src/entities/IngestionConnector";
import { Publisher } from "../src/entities/Publisher";
import { RejectedStoryAssignment } from "../src/entities/RejectedStoryAssignment";
import { Story, STORY_CATEGORIES } from "../src/entities/Story";
import { User } from "../src/entities/User";
import { createSynthesisProvider, type SynthesisProvider, type SynthesisRequest } from "../src/synthesis";
import { runConnector, type FetchText } from "../src/ingestion/runConnector";
import { setupTestDb } from "./setupTestDb";

// Redis is not in the test stack (#42), so the one enqueue call is recorded here.
// What that leaves untested is bullmq's own guarantee that a job id already in
// flight is not added twice; what it does test is everything either execution path
// does either side of the queue.
const { enqueued } = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock("../src/clustering/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/clustering/queue")>()),
  enqueueClusteringRun: async () => void enqueued.push("run"),
}));

setupTestDb();

const app = () => createApp();

// Similarity is the behaviour under test, so the vectors are the fixture. An axis
// vector rotated by `offAxis` radians within its own two-dimensional plane has
// cosine similarity exactly cos(offAxis) with the plane's axis vector, and 0 with
// every other plane — so a test can state "this pair is a match" or "this pair sits
// just under the threshold" as an angle rather than hoping a real model agrees.
// Planes are spaced so no two share a dimension.
function axisVector(plane: number, offAxis = 0): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[plane * 2] = Math.cos(offAxis);
  vector[plane * 2 + 1] = Math.sin(offAxis);
  return vector;
}

// An angle whose cosine sits comfortably under *both* thresholds: related
// reporting that is neither the same event nor a proposal worth an Admin's time.
const BELOW_REVIEW = Math.acos(REVIEW_THRESHOLD - 0.1);

// An angle placing a pair inside the review band (#50), `fraction` of the way from
// the review floor to the auto-accept ceiling — so a test can say "this is a
// proposal, and this one is the stronger proposal" without either landing on an
// edge, and without being retuned when the thresholds are.
function inReviewBand(fraction: number): number {
  return Math.acos(REVIEW_THRESHOLD + fraction * (SIMILARITY_THRESHOLD - REVIEW_THRESHOLD));
}

// The embedder as an injected fixture: it answers from a token in the text, and
// refuses anything it was not told about — so an unexpected embedding request is a
// failed test rather than a silent zero vector. It also records the size of every
// request, which is how "in batches rather than one request per Article" is checked.
class StubEmbedder implements EmbeddingProvider {
  readonly requests: number[] = [];

  constructor(private readonly byToken: Record<string, number[]>) {}

  async embed(text: string): Promise<number[]> {
    const token = Object.keys(this.byToken).find((key) => text.includes(key));
    if (!token) throw new Error(`StubEmbedder was asked to embed unexpected text: ${text.slice(0, 80)}`);
    return this.byToken[token];
  }

  async embedBatch(texts: string[], kind?: EmbeddingKind): Promise<number[][]> {
    expect(kind).toBe("passage");
    this.requests.push(texts.length);
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

const failingEmbedder: EmbeddingProvider = {
  embed: () => Promise.reject(new Error("429 rate limited")),
  embedBatch: () => Promise.reject(new Error("429 rate limited")),
};

// The namer as an injected fixture (#51), recording every call so "one call per new
// Story" can be counted. `answers` is what the provider returns, in order; running
// out means the test expected fewer calls than were made.
class StubNamer implements SynthesisProvider {
  readonly requests: SynthesisRequest[] = [];

  constructor(private readonly answers: string[]) {}

  async complete(request: SynthesisRequest): Promise<string> {
    this.requests.push(request);
    const answer = this.answers[this.requests.length - 1];
    if (answer === undefined) throw new Error(`StubNamer had no answer for call ${this.requests.length}`);
    return answer;
  }
}

const namingAnswer = (title: string, category: string) => JSON.stringify({ title, category });

// The default for every test whose subject is membership rather than naming: a
// provider that cannot answer, so the Story keeps the medoid title and the default
// category. Naming failing is not allowed to change any clustering outcome, which
// is exactly what those tests then assert.
const unavailableNamer: SynthesisProvider = {
  complete: () => Promise.reject(new Error("naming provider unavailable")),
};

function cluster(embedder: EmbeddingProvider, namer: SynthesisProvider = unavailableNamer) {
  return runClustering({ embedder, namer });
}

let nextArticle = 0;

async function createPublisher(domain: string): Promise<Publisher> {
  return AppDataSource.getRepository(Publisher).save({ domain, name: domain });
}

async function createArticle(fields: {
  publisherId: string;
  title: string;
  mode?: AnalysisTextMode;
  storyId?: string;
  // #50: a membership fixture states its decision, because that is what read paths
  // test. Accepted unless a test is setting up a proposal for the review queue.
  assignmentStatus?: StoryAssignmentStatus;
  assignmentScore?: number;
  publishedAt?: Date;
  vector?: number[];
}): Promise<Article> {
  nextArticle += 1;
  const mode = fields.mode ?? "feed_excerpt";
  const article = await AppDataSource.getRepository(Article).save({
    publisherId: fields.publisherId,
    storyId: fields.storyId ?? null,
    storyAssignmentStatus: fields.storyId ? (fields.assignmentStatus ?? "auto_accepted") : null,
    storyAssignmentScore: fields.storyId ? (fields.assignmentScore ?? 1) : null,
    title: fields.title,
    url: `https://${nextArticle}.example/story`,
    // `metadata_only` is the one rung that may hold no text (ADR-0024).
    analysisText: mode === "metadata_only" ? null : `${fields.title} body text`,
    analysisTextMode: mode,
    publishedAt: fields.publishedAt ?? new Date("2026-08-31T09:00:00Z"),
  });
  if (fields.vector) await setVector(article.id, fields.vector);
  return article;
}

async function createStory(fields: { title: string; lastSeenAt: Date }): Promise<Story> {
  return AppDataSource.getRepository(Story).save({
    slug: `${fields.title.toLowerCase().replace(/\W+/g, "-")}-${(nextArticle += 1)}`,
    title: fields.title,
    summary: null,
    category: "world",
    firstSeenAt: fields.lastSeenAt,
    lastSeenAt: fields.lastSeenAt,
  });
}

async function setVector(articleId: string, vector: number[]): Promise<void> {
  await AppDataSource.query(`UPDATE "articles" SET "embedding" = $1::vector WHERE "id" = $2`, [
    toVectorLiteral(vector),
    articleId,
  ]);
}

async function vectorOf(articleId: string): Promise<number[] | null> {
  const rows: { vector: string | null }[] = await AppDataSource.query(
    `SELECT "embedding"::text AS vector FROM "articles" WHERE "id" = $1`,
    [articleId],
  );
  return rows[0].vector === null ? null : (JSON.parse(rows[0].vector) as number[]);
}

async function storyCentroid(storyId: string): Promise<number[] | null> {
  const rows: { vector: string | null }[] = await AppDataSource.query(
    `SELECT "embedding"::text AS vector FROM "stories" WHERE "id" = $1`,
    [storyId],
  );
  return rows[0].vector === null ? null : (JSON.parse(rows[0].vector) as number[]);
}

async function createAdmin(email: string): Promise<User> {
  const passwordHash = await bcrypt.hash("correct-horse", 10);
  return AppDataSource.getRepository(User).save({ email, passwordHash, role: "admin" });
}

async function createAdminToken(email: string): Promise<string> {
  const user = await createAdmin(email);
  return signToken({ sub: user.id, role: user.role });
}

async function registerAndLogin(email: string, role: "student" | "investor"): Promise<string> {
  const res = await request(app()).post("/api/v1/auth/register").send({ email, password: "correct-horse", role });
  return res.body.token as string;
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

beforeEach(async () => {
  await AppDataSource.query(
    `TRUNCATE "articles", "publishers", "stories", "clustering_runs", "ingestion_runs", "ingestion_connectors",
              "rejected_story_assignments" CASCADE`,
  );
  enqueued.length = 0;
});

// Every Article a run considered ends in exactly one of the four outcomes, or an
// operator reading a run is reading a number that means nothing. Asserted for every
// run the suite persists, not only the ones a test thought to check.
afterEach(async () => {
  const offenders = await AppDataSource.query(
    `SELECT id, status, considered, assigned, "heldForReview", seeded, unclustered
       FROM clustering_runs
      WHERE assigned + "heldForReview" + seeded + unclustered <> considered`,
  );
  expect(offenders).toEqual([]);
});

// Seam 1: the clustering pass itself, driven as a function with an injected
// embedder — the same shape ingestion's runConnector is driven in.
describe("runClustering", () => {
  it("embeds every eligible Article without a vector in batches, and never an ineligible one", async () => {
    const publisher = await createPublisher("one.example");
    const excerpt = await createArticle({ publisherId: publisher.id, title: "alpha excerpt" });
    const extracted = await createArticle({ publisherId: publisher.id, title: "alpha body", mode: "api_content" });
    const licensed = await createArticle({
      publisherId: publisher.id,
      title: "alpha licensed",
      mode: "licensed_full_text",
    });
    // The two rungs clustering must never consider: firehose metadata, which is
    // what the Retention Window deletes, and the Curated Corpus (ADR-0026).
    const firehose = await createArticle({ publisherId: publisher.id, title: "alpha metadata", mode: "metadata_only" });
    const fixture = await createArticle({ publisherId: publisher.id, title: "alpha fixture", mode: "manual_fixture" });

    const embedder = new StubEmbedder({
      "alpha excerpt": axisVector(0),
      "alpha body": axisVector(1),
      "alpha licensed": axisVector(2),
    });
    const run = await cluster(embedder);

    expect(run.status).toBe("succeeded");
    expect(run.embedded).toBe(3);
    // One request for the three of them, not three requests: hosted limits count
    // requests (ADR-0025), so this is what decides whether a backlog drains.
    expect(embedder.requests).toEqual([3]);
    expect(EMBED_BATCH_SIZE).toBeGreaterThanOrEqual(3);
    for (const article of [excerpt, extracted, licensed]) {
      expect(await vectorOf(article.id)).not.toBeNull();
    }
    for (const article of [firehose, fixture]) {
      expect(await vectorOf(article.id)).toBeNull();
    }
    // A second run has nothing left to embed: a vector is written once and only
    // enrichment clears it.
    const second = await cluster(new StubEmbedder({}));
    expect(second.embedded).toBe(0);
  });

  it("drains an embedding backlog larger than the old per-run cap", async () => {
    const publisher = await createPublisher("backlog.example");
    const total = 201;
    for (let index = 0; index < total; index += 1) {
      await createArticle({ publisherId: publisher.id, title: `backlog ${index}` });
    }
    const requests: number[] = [];
    const embedder: EmbeddingProvider = {
      embed: async () => axisVector(0),
      embedBatch: async (texts, kind) => {
        expect(kind).toBe("passage");
        requests.push(texts.length);
        return texts.map(() => axisVector(0));
      },
    };

    const run = await cluster(embedder);

    expect(run.status).toBe("succeeded");
    expect(run.embedded).toBe(total);
    expect(requests.reduce((sum, size) => sum + size, 0)).toBe(total);
    expect(requests.every((size) => size <= EMBED_BATCH_SIZE)).toBe(true);
    expect(run.errorSummary).toBeNull();
  });

  it("joins an Article to the nearest live Story above the threshold and widens the Story's span", async () => {
    const publisher = await createPublisher("one.example");
    const other = await createPublisher("two.example");
    const story = await createStory({ title: "Ceasefire talks", lastSeenAt: hoursAgo(2) });
    await createArticle({
      publisherId: publisher.id,
      title: "member one",
      storyId: story.id,
      vector: axisVector(0),
      publishedAt: hoursAgo(2),
    });
    await createArticle({
      publisherId: other.id,
      title: "member two",
      storyId: story.id,
      vector: axisVector(0),
      publishedAt: hoursAgo(2),
    });
    const publishedAt = new Date();
    const candidate = await createArticle({
      publisherId: other.id,
      title: "same event, third outlet",
      vector: axisVector(0),
      publishedAt,
    });

    const run = await cluster(new StubEmbedder({}));

    expect(run.considered).toBe(1);
    expect(run.assigned).toBe(1);
    expect(run.seeded).toBe(0);
    expect(run.unclustered).toBe(0);
    const membership = await AppDataSource.getRepository(Article).findOneByOrFail({ id: candidate.id });
    expect(membership.storyId).toBe(story.id);
    expect(membership.storyAssignmentStatus).toBe("auto_accepted");
    expect(membership.storyAssignmentScore).toBeCloseTo(1);
    // The Story now spans the reporting it holds — which is both what browse sorts
    // by and what the recency gate reads on the next run.
    const grown = await AppDataSource.getRepository(Story).findOneByOrFail({ id: story.id });
    expect(grown.lastSeenAt.getTime()).toBe(publishedAt.getTime());
    // ADR-0026: every Story carries a centroid recomputed from its members.
    expect(await storyCentroid(story.id)).not.toBeNull();
  });

  it("refreshes a Story centroid so multiple candidates can join it in one run", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const third = await createPublisher("three.example");
    const fourth = await createPublisher("four.example");
    const story = await createStory({ title: "Growing event", lastSeenAt: hoursAgo(1) });
    await createArticle({ publisherId: first.id, title: "member one", storyId: story.id, vector: axisVector(0) });
    await createArticle({ publisherId: second.id, title: "member two", storyId: story.id, vector: axisVector(0) });
    const positive = await createArticle({
      publisherId: third.id,
      title: "positive candidate",
      vector: axisVector(0, 0.2),
      publishedAt: hoursAgo(0.5),
    });
    const negative = await createArticle({
      publisherId: fourth.id,
      title: "negative candidate",
      vector: axisVector(0, -0.2),
      publishedAt: hoursAgo(1),
    });

    const run = await cluster(new StubEmbedder({}));

    expect(run.assigned).toBe(2);
    const articles = AppDataSource.getRepository(Article);
    expect((await articles.findOneByOrFail({ id: positive.id })).storyId).toBe(story.id);
    expect((await articles.findOneByOrFail({ id: negative.id })).storyId).toBe(story.id);
  });

  it("does not assign against a Story centroid invalidated by concurrent enrichment", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const third = await createPublisher("three.example");
    const story = await createStory({ title: "Concurrent event", lastSeenAt: hoursAgo(1) });
    await createArticle({ publisherId: first.id, title: "member one", storyId: story.id, vector: axisVector(0) });
    const enriched = await createArticle({
      publisherId: second.id,
      title: "member two",
      storyId: story.id,
      vector: axisVector(0, 0.2),
    });
    const candidate = await createArticle({
      publisherId: third.id,
      title: "candidate",
      vector: axisVector(0, 0.1),
    });

    const query = AppDataSource.query.bind(AppDataSource);
    let invalidated = false;
    const querySpy = vi.spyOn(AppDataSource, "query").mockImplementation(async (sql: string, parameters?: unknown[]) => {
      const result = await query(sql, parameters);
      if (!invalidated && sql.includes(`ORDER BY "embedding" <=>`)) {
        invalidated = true;
        await query(`UPDATE "articles" SET "embedding" = NULL WHERE "id" = $1`, [enriched.id]);
      }
      return result;
    });
    const run = await cluster(new StubEmbedder({}));
    querySpy.mockRestore();

    expect(invalidated).toBe(true);
    expect(run.assigned).toBe(0);
    expect((await AppDataSource.getRepository(Article).findOneByOrFail({ id: candidate.id })).storyId).toBeNull();
  });

  it("refuses a dormant Story at any similarity, and a live one below the threshold", async () => {
    const publisher = await createPublisher("one.example");
    const dormant = await createStory({ title: "Old event", lastSeenAt: hoursAgo(RECENCY_WINDOW_HOURS + 1) });
    await createArticle({ publisherId: publisher.id, title: "old member", storyId: dormant.id, vector: axisVector(0) });
    const live = await createStory({ title: "Live event", lastSeenAt: hoursAgo(1) });
    await createArticle({ publisherId: publisher.id, title: "live member", storyId: live.id, vector: axisVector(1) });

    // An exact match for the dormant Story's centroid, and a near-match for the
    // live one's — neither may be assigned.
    const exactButDormant = await createArticle({
      publisherId: publisher.id,
      title: "anniversary piece",
      vector: axisVector(0),
    });
    const liveButWeak = await createArticle({
      publisherId: publisher.id,
      title: "related but different",
      vector: axisVector(1, BELOW_REVIEW),
    });

    const run = await cluster(new StubEmbedder({}));

    expect(run.considered).toBe(2);
    expect(run.assigned).toBe(0);
    expect(run.storiesCreated).toBe(0);
    expect(run.unclustered).toBe(2);
    const articles = AppDataSource.getRepository(Article);
    expect((await articles.findOneByOrFail({ id: exactButDormant.id })).storyId).toBeNull();
    expect((await articles.findOneByOrFail({ id: liveButWeak.id })).storyId).toBeNull();
  });

  it("will not seed a Story from one Publisher repeating itself", async () => {
    const publisher = await createPublisher("one.example");
    await createArticle({ publisherId: publisher.id, title: "first edition", vector: axisVector(0) });
    await createArticle({ publisherId: publisher.id, title: "second edition", vector: axisVector(0) });

    const run = await cluster(new StubEmbedder({}));

    expect(run.storiesCreated).toBe(0);
    expect(run.seeded).toBe(0);
    expect(run.unclustered).toBe(2);
    expect(await AppDataSource.getRepository(Story).count()).toBe(0);
  });

  it("abandons a new Story when Publisher correction removes independent corroboration", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const firstArticle = await createArticle({ publisherId: first.id, title: "first report", vector: axisVector(0) });
    const corrected = await createArticle({ publisherId: second.id, title: "second report", vector: axisVector(0) });

    const query = AppDataSource.query.bind(AppDataSource);
    let lookups = 0;
    const querySpy = vi.spyOn(AppDataSource, "query").mockImplementation(async (sql: string, parameters?: unknown[]) => {
      const result = await query(sql, parameters);
      if (sql.includes(`ORDER BY "embedding" <=>`) && (lookups += 1) === 2) {
        await query(`UPDATE "articles" SET "publisherId" = $1 WHERE "id" = $2`, [first.id, corrected.id]);
      }
      return result;
    });
    const run = await cluster(new StubEmbedder({}));
    querySpy.mockRestore();

    expect(run.seeded).toBe(0);
    expect(run.unclustered).toBe(2);
    expect(await AppDataSource.getRepository(Story).count()).toBe(0);
    expect((await AppDataSource.getRepository(Article).findOneByOrFail({ id: firstArticle.id })).storyId).toBeNull();
  });

  it("abandons a new Story when concurrent enrichment invalidates its medoid", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const third = await createPublisher("three.example");
    await createArticle({ publisherId: first.id, title: "outer one", vector: axisVector(0, 0.2), publishedAt: hoursAgo(3) });
    const staleMedoid = await createArticle({
      publisherId: second.id,
      title: "stale medoid",
      vector: axisVector(0),
      publishedAt: hoursAgo(2),
    });
    await createArticle({ publisherId: third.id, title: "outer two", vector: axisVector(0, -0.2), publishedAt: hoursAgo(1) });

    const query = AppDataSource.query.bind(AppDataSource);
    let lookups = 0;
    const querySpy = vi.spyOn(AppDataSource, "query").mockImplementation(async (sql: string, parameters?: unknown[]) => {
      const result = await query(sql, parameters);
      if (sql.includes(`ORDER BY "embedding" <=>`) && (lookups += 1) === 3) {
        await query(`UPDATE "articles" SET "embedding" = NULL WHERE "id" = $1`, [staleMedoid.id]);
      }
      return result;
    });
    const run = await cluster(new StubEmbedder({}));
    querySpy.mockRestore();

    expect(run.errorSummary).toBeNull();
    expect(run.seeded).toBe(0);
    expect(run.unclustered).toBe(3);
    expect(await AppDataSource.getRepository(Story).count()).toBe(0);
    expect((await AppDataSource.getRepository(Article).findOneByOrFail({ id: staleMedoid.id })).storyId).toBeNull();
  });

  it("seeds a Story from two corroborating Publishers, named after its medoid", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const third = await createPublisher("three.example");
    // The middle member is the medoid: it is the one both others match closely.
    const early = await createArticle({
      publisherId: first.id,
      title: "Regional talks reopen",
      vector: axisVector(0, 0.2),
      publishedAt: hoursAgo(5),
    });
    const medoid = await createArticle({
      publisherId: second.id,
      title: "Regional ceasefire talks resume",
      vector: axisVector(0),
      publishedAt: hoursAgo(3),
    });
    const late = await createArticle({
      publisherId: third.id,
      title: "Talks resume, mediators say",
      vector: axisVector(0, -0.2),
      publishedAt: hoursAgo(1),
    });
    // A fourth, unrelated Article: it matches nobody and must stay Unclustered.
    const unrelated = await createArticle({ publisherId: first.id, title: "Cup final venue", vector: axisVector(9) });

    const run = await cluster(new StubEmbedder({}));

    expect(run.storiesCreated).toBe(1);
    expect(run.seeded).toBe(3);
    expect(run.assigned).toBe(0);
    expect(run.unclustered).toBe(1);

    const story = await AppDataSource.getRepository(Story).findOneByOrFail({});
    // This run's namer cannot answer, so the medoid name is what the Story keeps.
    expect(story.title).toBe(medoid.title);
    expect(story.slug).toContain("regional-ceasefire-talks-resume");
    expect(story.category).toBe(DEFAULT_STORY_CATEGORY);
    // Nothing has synthesised this Story, so it claims no summary.
    expect(story.summary).toBeNull();
    expect(story.firstSeenAt.getTime()).toBe(early.publishedAt.getTime());
    expect(story.lastSeenAt.getTime()).toBe(late.publishedAt.getTime());
    // A Story is only complete once it carries the centroid of its members.
    expect(await storyCentroid(story.id)).not.toBeNull();

    const articles = AppDataSource.getRepository(Article);
    expect(await articles.countBy({ storyId: story.id })).toBe(3);
    expect((await articles.findOneByOrFail({ id: unrelated.id })).storyId).toBeNull();
  });

  it("does not put non-mutually-matching Articles in the same new Story", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const third = await createPublisher("three.example");
    const center = await createArticle({
      publisherId: first.id,
      title: "central report",
      vector: axisVector(0),
      publishedAt: hoursAgo(1),
    });
    const positive = await createArticle({
      publisherId: second.id,
      title: "positive report",
      vector: axisVector(0, 0.4),
      publishedAt: hoursAgo(2),
    });
    const negative = await createArticle({
      publisherId: third.id,
      title: "negative report",
      vector: axisVector(0, -0.4),
      publishedAt: hoursAgo(3),
    });

    const run = await cluster(new StubEmbedder({}));

    expect(run.storiesCreated).toBe(1);
    expect(run.seeded).toBe(2);
    expect(run.unclustered).toBe(1);
    const memberships = await AppDataSource.getRepository(Article).findByIds([center.id, positive.id, negative.id]);
    expect(memberships.filter((article) => article.storyId !== null)).toHaveLength(2);
  });

  it("makes newly clustered reporting visible in browse and search", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    await createArticle({ publisherId: first.id, title: "Harbour dredging contract awarded", vector: axisVector(0) });
    await createArticle({ publisherId: second.id, title: "Harbour dredging deal signed", vector: axisVector(0) });

    // Unclustered Articles are invisible by construction — every read path joins
    // through Story — so this is the before/after that matters.
    const token = await registerAndLogin("clustering-reader@example.com", "student");
    const before = await request(app()).get("/api/v1/search?q=dredging").set("Authorization", `Bearer ${token}`);
    expect(before.body.items).toEqual([]);

    await cluster(new StubEmbedder({}));

    const stories = await request(app()).get("/api/v1/stories").set("Authorization", `Bearer ${token}`);
    expect(stories.status).toBe(200);
    expect(stories.body.items).toHaveLength(1);
    expect(stories.body.items[0].articleCount).toBe(2);

    const after = await request(app()).get("/api/v1/search?q=dredging").set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(200);
    expect(after.body.items).toHaveLength(2);
  });

  it("gives a curated Story a centroid but never lets a live Article into it", async () => {
    const fixturePublisher = await createPublisher("curated.example");
    const livePublisher = await createPublisher("live.example");
    const curated = await createStory({ title: "Rehearsed demo Story", lastSeenAt: hoursAgo(1) });
    await createArticle({
      publisherId: fixturePublisher.id,
      title: "fixture one",
      mode: "manual_fixture",
      storyId: curated.id,
      vector: axisVector(0),
    });
    await createArticle({
      publisherId: fixturePublisher.id,
      title: "fixture two",
      mode: "manual_fixture",
      storyId: curated.id,
      vector: axisVector(0),
    });
    const live = await createArticle({ publisherId: livePublisher.id, title: "live report", vector: axisVector(0) });

    const run = await cluster(new StubEmbedder({}));

    // An exact match on the centroid, and still refused: the Curated Corpus is
    // closed to changes in membership (ADR-0026), which is what keeps a demo Story
    // from turning out half real and half invented.
    expect((await AppDataSource.getRepository(Article).findOneByOrFail({ id: live.id })).storyId).toBeNull();
    expect(run.unclustered).toBe(1);
    // Closed to membership, not to having a centroid.
    expect(await storyCentroid(curated.id)).not.toBeNull();
  });

  it("joins the nearest of two live Stories, not merely one above the threshold", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const near = await createStory({ title: "Nearer event", lastSeenAt: hoursAgo(2) });
    await createArticle({ publisherId: first.id, title: "near member", storyId: near.id, vector: axisVector(0) });
    const far = await createStory({ title: "Farther event", lastSeenAt: hoursAgo(2) });
    // Both centroids sit in the same plane, so both clear the threshold against the
    // candidate below — only their distance to it differs.
    await createArticle({ publisherId: first.id, title: "far member", storyId: far.id, vector: axisVector(0, 0.3) });
    const candidate = await createArticle({
      publisherId: second.id,
      title: "same event again",
      vector: axisVector(0, 0.05),
    });

    const run = await cluster(new StubEmbedder({}));

    expect(run.assigned).toBe(1);
    expect((await AppDataSource.getRepository(Article).findOneByOrFail({ id: candidate.id })).storyId).toBe(near.id);
  });

  it("drops a Story's centroid once enrichment has cleared its members' vectors", async () => {
    const publisher = await createPublisher("one.example");
    const story = await createStory({ title: "Stale event", lastSeenAt: hoursAgo(1) });
    const member = await createArticle({
      publisherId: publisher.id,
      title: "member awaiting re-embedding",
      storyId: story.id,
      vector: axisVector(0),
    });
    await cluster(new StubEmbedder({}));
    expect(await storyCentroid(story.id)).not.toBeNull();

    // What enrichment leaves behind: new text, and no vector describing it.
    await AppDataSource.query(`UPDATE "articles" SET "embedding" = NULL WHERE "id" = $1`, [member.id]);
    const candidate = await createArticle({
      publisherId: publisher.id,
      title: "matches the centroid that was",
      vector: axisVector(0),
    });

    // The member is re-embedded by this run, but only after the centroid pass — so
    // the Story is centroid-less while the candidate is scored, which is the point:
    // a Story must not match text Tessera no longer holds.
    const run = await cluster(new StubEmbedder({ "member awaiting": axisVector(9) }));

    expect(run.embedded).toBe(1);
    expect(run.assigned).toBe(0);
    expect((await AppDataSource.getRepository(Article).findOneByOrFail({ id: candidate.id })).storyId).toBeNull();
    // Recomputed from the re-embedded member at the end of the run, so the Story is
    // a complete row again — around its *new* text.
    expect(await storyCentroid(story.id)).not.toBeNull();
  });

  // ADR-0026's review band (#50). The band's whole purpose is that a borderline
  // score becomes a decision rather than either a silent membership or a discard.
  it("holds a borderline assignment for review, and lets it change nothing about the Story", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const seenAt = hoursAgo(3);
    const story = await createStory({ title: "Borderline event", lastSeenAt: seenAt });
    await createArticle({
      publisherId: first.id,
      title: "the one report there is",
      storyId: story.id,
      vector: axisVector(0),
      publishedAt: seenAt,
    });
    const offAxis = inReviewBand(0.5);
    const candidate = await createArticle({
      publisherId: second.id,
      title: "possibly the same event",
      vector: axisVector(0, offAxis),
      publishedAt: new Date(),
    });

    const run = await cluster(new StubEmbedder({}));

    expect(run.considered).toBe(1);
    expect(run.assigned).toBe(0);
    expect(run.heldForReview).toBe(1);
    // Not unclustered either: it is waiting on an Admin, not on the next run.
    expect(run.unclustered).toBe(0);
    expect(run.storiesCreated).toBe(0);

    const held = await AppDataSource.getRepository(Article).findOneByOrFail({ id: candidate.id });
    // The proposal is attached to the Story it proposes — the only way a reviewer
    // can be shown what is being proposed — and says so in its status.
    expect(held.storyId).toBe(story.id);
    expect(held.storyAssignmentStatus).toBe("pending_review");
    expect(held.storyAssignmentScore).toBeCloseTo(Math.cos(offAxis), 4);

    // And the Story is exactly as it was. Its span is what the recency gate reads,
    // so a guess must not be able to keep a Story alive; its centroid is what scores
    // every later candidate, so a guess must not be able to move the target.
    const unmoved = await AppDataSource.getRepository(Story).findOneByOrFail({ id: story.id });
    expect(unmoved.lastSeenAt.getTime()).toBe(seenAt.getTime());
    expect(await storyCentroid(story.id)).toEqual(axisVector(0));
  });

  it("keeps a held assignment out of browse, out of search, and out of Brief evidence", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const story = await createStory({ title: "Ferry terminal fire", lastSeenAt: hoursAgo(2) });
    await createArticle({
      publisherId: first.id,
      title: "Ferry terminal fire contained",
      storyId: story.id,
      vector: axisVector(0),
    });
    await createArticle({
      publisherId: second.id,
      title: "Ferry terminal blaze under control",
      storyId: story.id,
      vector: axisVector(0),
    });
    const held = await createArticle({
      publisherId: second.id,
      title: "Ferry services resume after weekend disruption",
      storyId: story.id,
      assignmentStatus: "pending_review",
      assignmentScore: 0.8,
      vector: axisVector(0, inReviewBand(0.5)),
    });

    const token = await registerAndLogin("clustering-review-reader@example.com", "student");
    const auth = { Authorization: `Bearer ${token}` };

    // Browse counts two members, not three: a count that included the proposal
    // would advertise coverage a reader cannot open.
    const list = await request(app()).get("/api/v1/stories").set(auth);
    expect(list.body.items[0].articleCount).toBe(2);

    const detail = await request(app()).get(`/api/v1/stories/${story.id}`).set(auth);
    expect(detail.body.articleCount).toBe(2);
    expect(detail.body.articles.map((article: { id: string }) => article.id)).not.toContain(held.id);

    // Not a partial record either: the same 404 an Unclustered Article gets, since
    // "we may have put this somewhere" is not a public state.
    const record = await request(app()).get(`/api/v1/articles/${held.id}`).set(auth);
    expect(record.status).toBe(404);

    const search = await request(app()).get("/api/v1/search?q=ferry").set(auth);
    expect(search.body.items.length).toBeGreaterThan(0);
    expect(search.body.items.map((item: { id: string }) => item.id)).not.toContain(held.id);

    // Evidence selection's boundary as it exists today: a Brief's Articles are
    // cited evidence, so a proposal cannot be attached to one.
    const brief = await request(app())
      .post("/api/v1/briefs")
      .set(auth)
      .send({ title: "Ferry disruption", category: "world" });
    expect(brief.status).toBe(201);
    const attached = await request(app())
      .post(`/api/v1/briefs/${brief.body.id}/articles`)
      .set(auth)
      .send({ articleId: held.id });
    expect(attached.status).toBe(422);
    expect(attached.body.error).toMatch(/clustered into a Story/);
  });

  it("stops proposing a pairing an Admin rejected, and offers the next-best Story instead", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const admin = await createAdmin("clustering-rejector@example.com");
    // Two live Stories, both inside the band against the candidate below, one
    // nearer than the other.
    const nearer = await createStory({ title: "Nearer reading", lastSeenAt: hoursAgo(2) });
    await createArticle({
      publisherId: first.id,
      title: "nearer member",
      storyId: nearer.id,
      vector: axisVector(0, inReviewBand(0.9)),
    });
    const farther = await createStory({ title: "Farther reading", lastSeenAt: hoursAgo(2) });
    await createArticle({
      publisherId: first.id,
      title: "farther member",
      storyId: farther.id,
      vector: axisVector(0, inReviewBand(0.1)),
    });
    const candidate = await createArticle({ publisherId: second.id, title: "ambiguous report", vector: axisVector(0) });

    const articles = AppDataSource.getRepository(Article);
    const firstRun = await cluster(new StubEmbedder({}));
    expect(firstRun.heldForReview).toBe(1);
    expect((await articles.findOneByOrFail({ id: candidate.id })).storyId).toBe(nearer.id);

    await decidePendingAssignment(candidate.id, "reject", admin.id);

    // The next run reconsiders the Article — it is Unclustered again — but the
    // refused pairing is off the table, so it proposes the other live Story.
    const secondRun = await cluster(new StubEmbedder({}));
    expect(secondRun.heldForReview).toBe(1);
    expect((await articles.findOneByOrFail({ id: candidate.id })).storyId).toBe(farther.id);

    await decidePendingAssignment(candidate.id, "reject", admin.id);

    // Both refused, so there is nothing left to propose: Unclustered, and quiet.
    const thirdRun = await cluster(new StubEmbedder({}));
    expect(thirdRun.heldForReview).toBe(0);
    expect(thirdRun.unclustered).toBe(1);
    expect((await articles.findOneByOrFail({ id: candidate.id })).storyId).toBeNull();
  });

  it("voids a proposal whose text enrichment has replaced, and rescores it from what is held now", async () => {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const story = await createStory({ title: "Revised event", lastSeenAt: hoursAgo(2) });
    await createArticle({
      publisherId: first.id,
      title: "the accepted member",
      storyId: story.id,
      vector: axisVector(0),
      publishedAt: hoursAgo(2),
    });
    const held = await createArticle({
      publisherId: second.id,
      title: "held on its teaser",
      storyId: story.id,
      assignmentStatus: "pending_review",
      assignmentScore: 0.8,
      vector: axisVector(0, inReviewBand(0.5)),
    });

    // What enrichment leaves behind: new text, and no vector describing it.
    await AppDataSource.query(`UPDATE "articles" SET "embedding" = NULL WHERE "id" = $1`, [held.id]);

    // The replacement text is nothing like the Story, so the rescore refuses it
    // outright — which is the point: the run decides on the text it holds now, and
    // the reviewer is never shown a score for a body that has been replaced.
    const run = await cluster(new StubEmbedder({ "held on its teaser": axisVector(9) }));

    expect(run.embedded).toBe(1);
    expect(run.considered).toBe(1);
    expect(run.heldForReview).toBe(0);
    expect(run.unclustered).toBe(1);
    const rescored = await AppDataSource.getRepository(Article).findOneByOrFail({ id: held.id });
    expect(rescored.storyId).toBeNull();
    expect(rescored.storyAssignmentStatus).toBeNull();
    expect(rescored.storyAssignmentScore).toBeNull();
  });

  it("records a run that could not embed as failed, with the reason on the row", async () => {
    const publisher = await createPublisher("one.example");
    await createArticle({ publisherId: publisher.id, title: "needs a vector" });

    const run = await cluster(failingEmbedder);

    expect(run.status).toBe("failed");
    expect(run.errorSummary).toContain("429 rate limited");
    expect(run.embedded).toBe(0);
    expect(run.completedAt).not.toBeNull();
  });
});

// #51: the one non-deterministic step. A model names each *new* Story once; every
// way that can go wrong lands back on the medoid title and the default category,
// because a badly-labelled cluster is not a broken one.
describe("story naming", () => {
  // Three Articles from three Publishers around one axis: the middle one is the
  // medoid, so a test can say which title the fallback must produce. `startHours`
  // orders whole clusters against each other, since candidates are read newest
  // first — which is the order naming calls are made in.
  async function seedableTrio(prefix: string, plane: number, startHours = 1): Promise<string> {
    const titles = [`${prefix} talks reopen`, `${prefix} ceasefire talks resume`, `${prefix} mediators confirm talks`];
    const offsets = [0.2, 0, -0.2];
    for (const [index, title] of titles.entries()) {
      const publisher = await createPublisher(`${prefix}-${index}.example`);
      await createArticle({
        publisherId: publisher.id,
        title,
        vector: axisVector(plane, offsets[index]),
        publishedAt: hoursAgo(startHours + index),
      });
    }
    return titles[1];
  }

  const storyTitles = async () =>
    (await AppDataSource.getRepository(Story).find({ order: { title: "ASC" } })).map((story) => story.title);

  it("names a new Story with one call, from its members' headlines alone", async () => {
    const medoidTitle = await seedableTrio("regional", 0);
    const namer = new StubNamer([namingAnswer("Ceasefire talks resume in the region", "politics")]);

    const run = await cluster(new StubEmbedder({}), namer);

    expect(run.status).toBe("succeeded");
    expect(run.storiesCreated).toBe(1);
    // One call for a three-Article Story: per new Story, never per Article.
    expect(namer.requests).toHaveLength(1);
    const [request] = namer.requests;
    expect(request.task).toBe("story_name");
    expect(request.json).toBe(true);
    // A hung endpoint must not hold the worker: naming is bounded (#42, concurrency 1).
    expect(request.timeoutMs).toBe(STORY_NAMING_TIMEOUT_MS);
    // Headlines only — no Article text leaves for a naming call (ADR-0018).
    expect(request.prompt).toContain(`- ${medoidTitle}`);
    expect(request.prompt).toContain("- regional talks reopen");
    expect(request.prompt).not.toContain("body text");

    const story = await AppDataSource.getRepository(Story).findOneByOrFail({});
    expect(story.title).toBe("Ceasefire talks resume in the region");
    expect(story.category).toBe("politics");
    // The slug follows the name the Story ended up with, not the medoid's.
    expect(story.slug).toContain("ceasefire-talks-resume-in-the-region");
  });

  it("makes one call per new Story and none for a Story that already exists", async () => {
    // An existing Story with a live centroid, and one Article that matches it.
    const existing = await createStory({ title: "Existing coverage", lastSeenAt: hoursAgo(2) });
    const member = await createPublisher("member.example");
    await createArticle({
      publisherId: member.id,
      title: "existing member",
      storyId: existing.id,
      vector: axisVector(5),
      publishedAt: hoursAgo(2),
    });
    const joiner = await createPublisher("joiner.example");
    await createArticle({
      publisherId: joiner.id,
      title: "joins the existing coverage",
      vector: axisVector(5, 0.1),
      publishedAt: hoursAgo(1),
    });
    // Two brand new clusters beside it, the older one named second.
    await seedableTrio("alpha", 0, 2);
    await seedableTrio("beta", 1, 6);
    const namer = new StubNamer([namingAnswer("Alpha named", "world"), namingAnswer("Beta named", "business")]);

    const run = await cluster(new StubEmbedder({}), namer);

    expect(run.assigned).toBe(1);
    expect(run.storiesCreated).toBe(2);
    // Two new Stories, two calls. The Story that already existed is not renamed,
    // and gaining a member is not an occasion to rename it either.
    expect(namer.requests).toHaveLength(2);
    expect(await storyTitles()).toEqual(["Alpha named", "Beta named", "Existing coverage"]);
  });

  it("keeps the medoid name when the answer is not an exact vocabulary value", async () => {
    const medoidTitle = await seedableTrio("regional", 0);
    const namer = new StubNamer([namingAnswer("A perfectly good title", "POLITICS")]);

    const run = await cluster(new StubEmbedder({}), namer);

    expect(run.status).toBe("succeeded");
    expect(run.storiesCreated).toBe(1);
    // Refused whole, not repaired: a Story is never half a model's judgement and
    // half ours, so the title goes back with the category.
    const story = await AppDataSource.getRepository(Story).findOneByOrFail({});
    expect(story.title).toBe(medoidTitle);
    expect(story.category).toBe(DEFAULT_STORY_CATEGORY);
    expect(STORY_CATEGORIES).not.toContain("POLITICS");
  });

  it("keeps the medoid name when the call fails or answers with prose", async () => {
    const firstMedoid = await seedableTrio("alpha", 0, 1);
    const secondMedoid = await seedableTrio("beta", 1, 5);
    const namer = new StubNamer(["Sure! Here are some ideas for a title."]);

    // The first cluster gets prose; the second gets a thrown error, because the
    // stub has run out of answers.
    const run = await cluster(new StubEmbedder({}), namer);

    expect(run.status).toBe("succeeded");
    expect(run.errorSummary).toBeNull();
    expect(run.storiesCreated).toBe(2);
    expect(run.seeded).toBe(6);
    expect(await storyTitles()).toEqual([firstMedoid, secondMedoid].sort());
  });

  it("is named by the deterministic Mock when no API key is configured", async () => {
    expect(process.env.SYNTHESIS_API_KEY ?? "").toBe("");
    const medoidTitle = await seedableTrio("regional", 0);

    const run = await cluster(new StubEmbedder({}), createSynthesisProvider());

    expect(run.status).toBe("succeeded");
    const story = await AppDataSource.getRepository(Story).findOneByOrFail({});
    // The Mock answers rather than falling back, and says so in the title: an
    // offline demo gets named Stories that admit no model named them.
    expect(story.title).toBe(`[mock] ${medoidTitle}`);
    expect(STORY_CATEGORIES).toContain(story.category);
  });
});

// The other half of ADR-0026's embedding rule: a vector must not outlive the text
// it was made from. Driven through ingestion's real enrichment path rather than by
// writing NULL by hand, because the requirement is that *enrichment* clears it.
describe("enrichment and the clustering job together", () => {
  const nprUrl = "https://www.npr.org/2026/08/30/nx-s1-5949254/lake-ontario-america-doug-ford-trump-sign-google";
  const nprFeed: FetchText = () => readFile(join(__dirname, "fixtures", "rss", "npr-world.xml"), "utf-8");
  const noFeed: FetchText = () => Promise.reject(new Error("extraction must not fetch a feed"));

  it("clears a pending proposal when extraction replaces its text, then re-embeds", async () => {
    const connectors = AppDataSource.getRepository(IngestionConnector);
    const rss = await connectors.save({
      name: "Test RSS",
      kind: "rss",
      endpoint: "https://feeds.npr.org/1004/rss.xml",
      enabled: true,
      feedProvidesFullText: false,
    });
    expect((await runConnector(rss, { fetchText: nprFeed }))!.inserted).toBe(3);

    const articles = AppDataSource.getRepository(Article);
    const teaser = await articles.findOneByOrFail({ url: nprUrl });
    // Three excerpts, one request, three vectors.
    const embedder = new StubEmbedder({
      "Lake Ontario": axisVector(0),
      Venezuela: axisVector(1),
      "Dolly Parton": axisVector(2),
    });
    const first = await cluster(embedder);
    expect(first.embedded).toBe(3);
    expect(await vectorOf(teaser.id)).not.toBeNull();

    const proposedStory = await createStory({ title: "Lake Ontario proposal", lastSeenAt: hoursAgo(1) });
    await articles.update(
      { id: teaser.id },
      { storyId: proposedStory.id, storyAssignmentStatus: "pending_review", storyAssignmentScore: 0.8 },
    );

    const extraction = await connectors.save({
      name: "Test extraction",
      kind: "readability",
      endpoint: "internal:readability",
      enabled: true,
    });
    const extracted = await runConnector(extraction, {
      fetchText: noFeed,
      fetchPage: (url) =>
        url === nprUrl
          ? readFile(join(__dirname, "fixtures", "readability", "npr-lake-ontario.html"), "utf-8")
          : readFile(join(__dirname, "fixtures", "readability", "bot-challenge.html"), "utf-8"),
    });
    expect(extracted!.enriched).toBe(1);

    // The proposal scored the excerpt that extraction replaced, so enrichment
    // invalidates the assignment together with its vector. It must not remain
    // available for an Admin to accept before the next clustering run.
    const invalidated = await articles.findOneByOrFail({ id: teaser.id });
    expect(await vectorOf(teaser.id)).toBeNull();
    expect(invalidated.storyId).toBeNull();
    expect(invalidated.storyAssignmentStatus).toBeNull();
    expect(invalidated.storyAssignmentScore).toBeNull();
    expect(await decidePendingAssignment(teaser.id, "accept", (await createAdmin("stale-reviewer@example.com")).id)).toBeNull();

    const untouched = await articles.findBy({ analysisTextMode: "feed_excerpt" });
    expect(untouched).toHaveLength(2);
    for (const article of untouched) expect(await vectorOf(article.id)).not.toBeNull();

    const second = await cluster(embedder);
    expect(second.embedded).toBe(1);
    expect(await vectorOf(teaser.id)).not.toBeNull();
  });
});

// Seam 2: only what is HTTP-visible — the trigger's RBAC, that it enqueues rather
// than running in the request, and that history reaches the Admin console.
describe("POST /api/v1/clustering/runs", () => {
  it("is Admin-only, and no refusal reaches the queue", async () => {
    const anonymous = await request(app()).post("/api/v1/clustering/runs");
    expect(anonymous.status).toBe(401);

    const studentToken = await registerAndLogin("clustering-student@example.com", "student");
    const student = await request(app())
      .post("/api/v1/clustering/runs")
      .set("Authorization", `Bearer ${studentToken}`);
    expect(student.status).toBe(403);

    const investorToken = await registerAndLogin("clustering-investor@example.com", "investor");
    const investor = await request(app())
      .post("/api/v1/clustering/runs")
      .set("Authorization", `Bearer ${investorToken}`);
    expect(investor.status).toBe(403);

    expect(enqueued).toEqual([]);
    expect(await AppDataSource.getRepository(ClusteringRun).count()).toBe(0);
  });

  it("accepts the command by enqueueing it, and clusters nothing in the request", async () => {
    const token = await createAdminToken("clustering-admin@example.com");

    const res = await request(app()).post("/api/v1/clustering/runs").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "accepted" });
    expect(enqueued).toEqual(["run"]);
    // The worker is what runs it, so the request itself persisted no run.
    expect(await AppDataSource.getRepository(ClusteringRun).count()).toBe(0);
  });

  it("carries clustering run history on the Admin dashboard, with no worker running", async () => {
    const token = await createAdminToken("clustering-history@example.com");
    await AppDataSource.getRepository(ClusteringRun).save({
      status: "succeeded",
      startedAt: new Date("2026-08-31T10:00:00Z"),
      completedAt: new Date("2026-08-31T10:00:20Z"),
      embedded: 12,
      considered: 12,
      assigned: 4,
      seeded: 6,
      unclustered: 2,
      storiesCreated: 3,
      errorSummary: null,
    });

    const res = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.clusteringRuns).toHaveLength(1);
    expect(res.body.clusteringRuns[0]).toMatchObject({
      status: "succeeded",
      embedded: 12,
      considered: 12,
      assigned: 4,
      seeded: 6,
      unclustered: 2,
      storiesCreated: 3,
      errorSummary: null,
    });
  });
});

// The Admin review queue's own seam: what is HTTP-visible about working the band —
// who may read it, what a row states, and what each decision does to the corpus.
describe("the Admin review queue", () => {
  async function seedProposal(score = 0.8): Promise<{ story: Story; article: Article; member: Article }> {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const story = await createStory({ title: "Grid interconnector delayed", lastSeenAt: hoursAgo(4) });
    const member = await createArticle({
      publisherId: first.id,
      title: "Interconnector slips to 2029",
      storyId: story.id,
      vector: axisVector(0),
      publishedAt: hoursAgo(4),
    });
    const article = await createArticle({
      publisherId: second.id,
      title: "Grid operator revises connection timetable",
      storyId: story.id,
      assignmentStatus: "pending_review",
      assignmentScore: score,
      vector: axisVector(0, inReviewBand(0.5)),
      publishedAt: hoursAgo(1),
    });
    return { story, article, member };
  }

  it("is Admin-only, on both the queue and the decision", async () => {
    const { article } = await seedProposal();
    const decide = (token?: string) => {
      const req = request(app()).patch(`/api/v1/clustering/pending/${article.id}`).send({ decision: "accept" });
      return token ? req.set("Authorization", `Bearer ${token}`) : req;
    };

    expect((await request(app()).get("/api/v1/clustering/pending")).status).toBe(401);
    expect((await decide()).status).toBe(401);

    for (const role of ["student", "investor"] as const) {
      const token = await registerAndLogin(`review-${role}@example.com`, role);
      const queue = await request(app()).get("/api/v1/clustering/pending").set("Authorization", `Bearer ${token}`);
      expect(queue.status).toBe(403);
      expect((await decide(token)).status).toBe(403);
    }

    // Refused all four times, so the proposal is exactly where it was.
    expect((await AppDataSource.getRepository(Article).findOneByOrFail({ id: article.id })).storyAssignmentStatus).toBe(
      "pending_review",
    );
  });

  it("lists each proposal with the Article, the Story proposed, and the score behind it", async () => {
    const { story, article } = await seedProposal(0.81);
    const token = await createAdminToken("review-lister@example.com");

    const res = await request(app()).get("/api/v1/clustering/pending").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const [proposal] = res.body.items;
    expect(proposal.id).toBe(article.id);
    expect(proposal.title).toBe(article.title);
    expect(proposal.publisher.domain).toBe("two.example");
    expect(proposal.score).toBeCloseTo(0.81);
    expect(proposal.proposedStory).toMatchObject({ id: story.id, slug: story.slug, title: story.title });
    // The accepted member is not a proposal and is not in the queue.
    expect(res.body.items).toHaveLength(1);
  });

  it("answers an empty queue as an empty page rather than a refusal", async () => {
    const token = await createAdminToken("review-empty@example.com");

    const res = await request(app()).get("/api/v1/clustering/pending").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 0, totalPages: 1 });
  });

  it("makes an accepted proposal a full member, and moves the Story with it", async () => {
    const { story, article } = await seedProposal();
    const token = await createAdminToken("review-accepter@example.com");
    expect(await storyCentroid(story.id)).toBeNull();

    const res = await request(app())
      .patch(`/api/v1/clustering/pending/${article.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "accept" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ articleId: article.id, storyId: story.id, decision: "accept" });

    const accepted = await AppDataSource.getRepository(Article).findOneByOrFail({ id: article.id });
    expect(accepted.storyId).toBe(story.id);
    expect(accepted.storyAssignmentStatus).toBe("auto_accepted");
    // The score records what proposed the membership; a human accepting 0.8 has not
    // made it a 1.
    expect(accepted.storyAssignmentScore).toBeCloseTo(0.8);

    // ADR-0026: the centroid is the mean of the Story's members, so accepting one
    // has to move it — the next run scores candidates against this.
    const centroid = await storyCentroid(story.id);
    expect(centroid).not.toBeNull();
    expect(centroid![0]).toBeCloseTo((1 + Math.cos(inReviewBand(0.5))) / 2, 4);
    const grown = await AppDataSource.getRepository(Story).findOneByOrFail({ id: story.id });
    expect(grown.lastSeenAt.getTime()).toBe(accepted.publishedAt.getTime());

    // And the Article is a public record now, where it was a 404 a moment ago.
    const reader = await registerAndLogin("review-after-accept@example.com", "student");
    const record = await request(app())
      .get(`/api/v1/articles/${article.id}`)
      .set("Authorization", `Bearer ${reader}`);
    expect(record.status).toBe(200);
    expect(record.body.story.id).toBe(story.id);
  });

  it("leaves a rejected proposal Unclustered, and remembers the refusal", async () => {
    const { story, article, member } = await seedProposal();
    const token = await createAdminToken("review-rejecter@example.com");

    const res = await request(app())
      .patch(`/api/v1/clustering/pending/${article.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "reject" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ articleId: article.id, storyId: story.id, decision: "reject" });

    const rejected = await AppDataSource.getRepository(Article).findOneByOrFail({ id: article.id });
    expect(rejected.storyId).toBeNull();
    // Unclustered carries no decision and no score (ADR-0026) — a leftover score
    // would read as a membership that had been scored rather than one refused.
    expect(rejected.storyAssignmentStatus).toBeNull();
    expect(rejected.storyAssignmentScore).toBeNull();

    const remembered = await AppDataSource.getRepository(RejectedStoryAssignment).find();
    expect(remembered).toHaveLength(1);
    expect(remembered[0]).toMatchObject({ articleId: article.id, storyId: story.id });
    expect(remembered[0].rejectedByUserId).not.toBeNull();

    // The Story is untouched: the proposal never counted, so removing it changes
    // nothing about the member it does have.
    const untouched = await AppDataSource.getRepository(Article).findOneByOrFail({ id: member.id });
    expect(untouched.storyId).toBe(story.id);
  });

  it("refuses a decision it cannot act on rather than inventing one", async () => {
    const { article } = await seedProposal();
    const token = await createAdminToken("review-refuser@example.com");
    const auth = { Authorization: `Bearer ${token}` };

    const unknown = await request(app())
      .patch(`/api/v1/clustering/pending/${article.id}`)
      .set(auth)
      .send({ decision: "merge" });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toMatch(/accept, reject/);

    const notAnId = await request(app()).patch("/api/v1/clustering/pending/not-a-uuid").set(auth).send({
      decision: "accept",
    });
    expect(notAnId.status).toBe(404);

    // Deciding the same proposal twice: the second decision has nothing pending to
    // act on, which is the same answer a second operator racing the first gets.
    expect(
      (await request(app()).patch(`/api/v1/clustering/pending/${article.id}`).set(auth).send({ decision: "accept" }))
        .status,
    ).toBe(200);
    const again = await request(app())
      .patch(`/api/v1/clustering/pending/${article.id}`)
      .set(auth)
      .send({ decision: "reject" });
    expect(again.status).toBe(404);
    expect(await AppDataSource.getRepository(RejectedStoryAssignment).count()).toBe(0);
  });
});

// The other half of the Admin's clustering surface (#52): the correction a
// deliberately tight threshold makes necessary. Not a proposal anyone made — an
// operator has read both Stories and decided they are one event.
describe("merging two Stories", () => {
  async function seedMergeablePair() {
    const first = await createPublisher("one.example");
    const second = await createPublisher("two.example");
    const survivor = await createStory({ title: "Refinery outage", lastSeenAt: hoursAgo(8) });
    const merged = await createStory({ title: "Refinery fire", lastSeenAt: hoursAgo(3) });
    // Two accepted members each, on two planes, so a centroid recomputed from the
    // merged membership is a different number from either Story's own.
    const kept = [
      await createArticle({
        publisherId: first.id,
        title: "Outage cuts refinery output",
        storyId: survivor.id,
        vector: axisVector(0),
        publishedAt: hoursAgo(10),
      }),
      await createArticle({
        publisherId: second.id,
        title: "Refining output down after outage",
        storyId: survivor.id,
        vector: axisVector(0),
        publishedAt: hoursAgo(8),
      }),
    ];
    const moved = [
      await createArticle({
        publisherId: first.id,
        title: "Fire at the refinery",
        storyId: merged.id,
        vector: axisVector(1),
        publishedAt: hoursAgo(6),
      }),
      await createArticle({
        publisherId: second.id,
        title: "Blaze halts refining",
        storyId: merged.id,
        vector: axisVector(1),
        publishedAt: hoursAgo(3),
      }),
    ];
    // A proposal on the Story being merged away: a decision nobody has made, which
    // the merge must carry over rather than settle on an Admin's behalf.
    const proposal = await createArticle({
      publisherId: second.id,
      title: "Fuel prices tick up",
      storyId: merged.id,
      assignmentStatus: "pending_review",
      assignmentScore: 0.79,
      vector: axisVector(5),
      publishedAt: hoursAgo(1),
    });
    return { survivor, merged, kept, moved, proposal };
  }

  const merge = (token: string, body: Record<string, unknown>) =>
    request(app()).post("/api/v1/clustering/merges").set("Authorization", `Bearer ${token}`).send(body);

  it("moves every Article to the survivor, recomputes it, and deletes the emptied Story", async () => {
    const { survivor, merged, kept, moved, proposal } = await seedMergeablePair();
    const token = await createAdminToken("merge-operator@example.com");

    const res = await merge(token, { survivorStoryId: survivor.id, mergedStoryId: merged.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ survivorStoryId: survivor.id, mergedStoryId: merged.id, movedArticles: 3 });

    const articles = AppDataSource.getRepository(Article);
    for (const article of [...moved, proposal]) {
      expect((await articles.findOneByOrFail({ id: article.id })).storyId).toBe(survivor.id);
    }
    // Pending before, pending after: a merge is a correction to the Stories, not a
    // decision about the Articles. Its score is rescored against the survivor, which
    // the test below is about.
    const held = await articles.findOneByOrFail({ id: proposal.id });
    expect(held.storyAssignmentStatus).toBe("pending_review");

    // ADR-0026's centroid over the merged membership: the mean of four accepted
    // members, two on each plane. The proposal moved with the rest and counts for
    // neither the mean nor the span (#50).
    const centroid = await storyCentroid(survivor.id);
    expect(centroid![0]).toBeCloseTo(0.5, 6);
    expect(centroid![2]).toBeCloseTo(0.5, 6);
    expect(centroid![10]).toBeCloseTo(0, 6);

    const grown = await AppDataSource.getRepository(Story).findOneByOrFail({ id: survivor.id });
    expect(grown.firstSeenAt.getTime()).toBe(kept[0].publishedAt.getTime());
    expect(grown.lastSeenAt.getTime()).toBe(moved[1].publishedAt.getTime());

    // Deleted, not tombstoned — and it took no Articles with it, though
    // articles."storyId" cascades on delete.
    expect(await AppDataSource.getRepository(Story).findOneBy({ id: merged.id })).toBeNull();
    expect(await articles.count()).toBe(5);

    // What a reader sees: one Story carrying both sets of reporting.
    const reader = await registerAndLogin("merge-reader@example.com", "student");
    const detail = await request(app())
      .get(`/api/v1/stories/${survivor.id}`)
      .set("Authorization", `Bearer ${reader}`);
    expect(detail.status).toBe(200);
    expect(detail.body.articleCount).toBe(4);
  });

  it("leaves a Brief citing a moved Article untouched", async () => {
    const { survivor, merged, moved } = await seedMergeablePair();
    const reader = await registerAndLogin("merge-brief-owner@example.com", "student");
    const auth = { Authorization: `Bearer ${reader}` };
    const brief = await request(app()).post("/api/v1/briefs").set(auth).send({
      title: "Refinery exposure",
      category: "business",
    });
    expect(brief.status).toBe(201);
    expect(
      (await request(app()).post(`/api/v1/briefs/${brief.body.id}/articles`).set(auth).send({ articleId: moved[0].id }))
        .status,
    ).toBe(201);

    const token = await createAdminToken("merge-brief-operator@example.com");
    expect((await merge(token, { survivorStoryId: survivor.id, mergedStoryId: merged.id })).status).toBe(200);

    // Evidence is pinned to Articles, so the Story it was reached through changing
    // underneath it must not disturb what a Brief cites.
    const after = await request(app()).get(`/api/v1/briefs/${brief.body.id}`).set(auth);
    expect(after.status).toBe(200);
    expect(after.body.articles.map((article: { id: string }) => article.id)).toEqual([moved[0].id]);
  });

  it("rescores a moved proposal against the survivor, and unscores one it cannot score", async () => {
    const { survivor, merged, proposal } = await seedMergeablePair();
    // A proposal with no vector left: what enrichment leaves behind when it writes
    // new text (ADR-0026).
    const unscorable = await createArticle({
      publisherId: proposal.publisherId,
      title: "held on text since replaced",
      storyId: merged.id,
      assignmentStatus: "pending_review",
      assignmentScore: 0.83,
    });
    await AppDataSource.query(`UPDATE "articles" SET "embedding" = NULL WHERE "id" = $1`, [unscorable.id]);
    const token = await createAdminToken("merge-rescorer@example.com");

    expect((await merge(token, { survivorStoryId: survivor.id, mergedStoryId: merged.id })).status).toBe(200);

    // The queue states this number and sorts by it, so after the merge it has to
    // describe the survivor: the proposal's vector is orthogonal to the survivor's
    // recomputed centroid, so 0 — not the 0.79 measured against a Story that is gone.
    const articles = AppDataSource.getRepository(Article);
    expect((await articles.findOneByOrFail({ id: proposal.id })).storyAssignmentScore).toBeCloseTo(0, 6);
    // Nothing to compare, so no number rather than a stale one. Still pending: a
    // merge decides nothing about the Articles.
    const held = await articles.findOneByOrFail({ id: unscorable.id });
    expect(held.storyAssignmentScore).toBeNull();
    expect(held.storyAssignmentStatus).toBe("pending_review");
    expect(held.storyId).toBe(survivor.id);
  });

  it("refuses a merge that would not be a correction", async () => {
    const { survivor, merged } = await seedMergeablePair();
    const token = await createAdminToken("merge-refuser@example.com");

    const itself = await merge(token, { survivorStoryId: survivor.id, mergedStoryId: survivor.id });
    expect(itself.status).toBe(422);
    expect(itself.body.error).toMatch(/itself/);

    // A well-formed id for a Story that is not there is a 404; anything that is not
    // a Story id at all never described one, so it is refused as a bad request.
    expect((await merge(token, { survivorStoryId: survivor.id, mergedStoryId: randomUUID() })).status).toBe(404);
    expect((await merge(token, { survivorStoryId: "not-a-uuid", mergedStoryId: merged.id })).status).toBe(422);
    expect((await merge(token, {})).status).toBe(422);

    // Refused five times, so both Stories and every Article are where they were.
    expect(await AppDataSource.getRepository(Story).count()).toBe(2);
    expect(await AppDataSource.getRepository(Article).countBy({ storyId: merged.id })).toBe(3);
  });

  it("refuses a merge into or out of the Curated Corpus", async () => {
    const { survivor, merged } = await seedMergeablePair();
    const fixtures = await createPublisher("fixture.example");
    const curated = await createStory({ title: "Curated Story", lastSeenAt: hoursAgo(5) });
    await createArticle({
      publisherId: fixtures.id,
      title: "seeded fixture piece",
      mode: "manual_fixture",
      storyId: curated.id,
      vector: axisVector(2),
    });
    const token = await createAdminToken("merge-curated@example.com");

    // ADR-0026 closes the Curated Corpus in both directions, and a merge by hand is
    // still a move: neither into it nor out of it.
    for (const body of [
      { survivorStoryId: curated.id, mergedStoryId: merged.id },
      { survivorStoryId: survivor.id, mergedStoryId: curated.id },
    ]) {
      const res = await merge(token, body);
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/Curated Corpus/);
    }

    expect(await AppDataSource.getRepository(Story).count()).toBe(3);
    expect(await AppDataSource.getRepository(Article).countBy({ storyId: curated.id })).toBe(1);
  });

  it("is Admin-only", async () => {
    const { survivor, merged } = await seedMergeablePair();
    const body = { survivorStoryId: survivor.id, mergedStoryId: merged.id };

    expect((await request(app()).post("/api/v1/clustering/merges").send(body)).status).toBe(401);
    for (const role of ["student", "investor"] as const) {
      const token = await registerAndLogin(`merge-${role}@example.com`, role);
      expect((await merge(token, body)).status).toBe(403);
    }

    expect(await AppDataSource.getRepository(Story).count()).toBe(2);
  });
});

// The worker's side of the same queue, driven as a function rather than as a
// process: the tick only fans out, and a run job is the one thing that clusters.
describe("the clustering worker job", () => {
  it("enqueues a run on the tick and clusters on the run job", async () => {
    await runClusteringJob({ name: CLUSTERING_TICK_JOB });
    expect(enqueued).toEqual(["run"]);
    expect(await AppDataSource.getRepository(ClusteringRun).count()).toBe(0);

    // The run job goes through the same runClustering the Admin trigger reaches
    // through the queue — with the Mock provider, since no key is configured in
    // tests (ADR-0023).
    await runClusteringJob({ name: CLUSTERING_RUN_JOB });
    const runs = await AppDataSource.getRepository(ClusteringRun).find();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("succeeded");
  });

  it("refuses a job name it does not know", async () => {
    await expect(runClusteringJob({ name: "sweep" })).rejects.toThrow(/Unknown clustering job/);
  });
});
