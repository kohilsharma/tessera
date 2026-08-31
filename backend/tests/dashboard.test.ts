import "reflect-metadata";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { User } from "../src/entities/User";
import { Article } from "../src/entities/Article";
import { IngestionConnector } from "../src/entities/IngestionConnector";
import { Publisher } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { signToken } from "../src/auth/jwt";
import { EMBEDDING_DIMENSIONS } from "../src/embeddings/EmbeddingProvider";
import { toVectorLiteral } from "../src/embeddings/pgvector";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

const app = () => createApp();

async function registerAndLogin(email: string, role: "student" | "investor"): Promise<string> {
  const res = await request(app()).post("/api/v1/auth/register").send({ email, password: "correct-horse", role });
  return res.body.token as string;
}

// Admin is assigned, never self-registered (auth.test.ts already proves the API
// rejects role: "admin" at register), so an admin fixture is created directly.
async function createAdminToken(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash("correct-horse", 10);
  const user = await AppDataSource.getRepository(User).save({ email, passwordHash, role: "admin" });
  return signToken({ sub: user.id, role: user.role });
}

function createPublisher(domain: string): Promise<Publisher> {
  return AppDataSource.getRepository(Publisher).save({ name: domain, domain });
}

function createStory(slug: string, title: string): Promise<Story> {
  return AppDataSource.getRepository(Story).save({
    slug,
    title,
    summary: null,
    category: "technology",
    firstSeenAt: new Date("2026-01-02T00:00:00Z"),
    lastSeenAt: new Date("2026-01-09T00:00:00Z"),
  });
}

// A member of a Story as the reader-facing surfaces see one: accepted, carrying
// analysis text, and embedded. Each of those is a condition the Investor register
// below turns on, so each is a parameter here.
let nextMember = 0;
async function createMember(fields: {
  storyId: string;
  publisherId: string;
  title: string;
  status?: "auto_accepted" | "pending_review";
  embedded?: boolean;
}): Promise<Article> {
  nextMember += 1;
  const article = await AppDataSource.getRepository(Article).save({
    storyId: fields.storyId,
    storyAssignmentStatus: fields.status ?? ("auto_accepted" as const),
    storyAssignmentScore: 0.9,
    publisherId: fields.publisherId,
    title: fields.title,
    url: `https://member-${nextMember}.example/report`,
    analysisText: `${fields.title} body text`,
    analysisTextMode: "manual_fixture",
    publishedAt: new Date("2026-01-05T00:00:00Z"),
  });
  if (fields.embedded !== false) {
    const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    vector[nextMember % EMBEDDING_DIMENSIONS] = 1;
    await AppDataSource.query(`UPDATE "articles" SET "embedding" = $1::vector WHERE "id" = $2`, [
      toVectorLiteral(vector),
      article.id,
    ]);
  }
  return article;
}

describe("dashboard RBAC", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app()).get("/api/v1/dashboard/student");
    expect(res.status).toBe(401);
  });

  it("lets a Student read the Student dashboard and blocks Investor/Admin", async () => {
    const token = await registerAndLogin("student-dash@example.com", "student");

    const brief = await request(app())
      .post("/api/v1/briefs")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Study Brief", category: "technology" });

    const own = await request(app()).get("/api/v1/dashboard/student").set("Authorization", `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      role: "student",
      studyCollections: [{ id: brief.body.id, title: "Study Brief", category: "technology" }],
    });

    const investor = await request(app()).get("/api/v1/dashboard/investor").set("Authorization", `Bearer ${token}`);
    expect(investor.status).toBe(403);

    const admin = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);
    expect(admin.status).toBe(403);
  });

  it("lets an Investor read the Investor dashboard and blocks Student/Admin", async () => {
    const token = await registerAndLogin("investor-dash@example.com", "investor");

    const own = await request(app()).get("/api/v1/dashboard/investor").set("Authorization", `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body.role).toBe("investor");
    expect(own.body.sectors).toEqual([]);

    const student = await request(app()).get("/api/v1/dashboard/student").set("Authorization", `Bearer ${token}`);
    expect(student.status).toBe(403);

    const admin = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);
    expect(admin.status).toBe(403);
  });

  it("rolls the corpus up by sector for an Investor", async () => {
    const token = await registerAndLogin("investor-sectors@example.com", "investor");
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "Sector Wire",
      domain: "sector-wire.example",
    });
    const story = await AppDataSource.getRepository(Story).save({
      slug: "sector-rollup-story",
      title: "Chip capacity expands",
      summary: null,
      category: "technology",
      firstSeenAt: new Date("2026-01-02T00:00:00Z"),
      lastSeenAt: new Date("2026-01-02T00:00:00Z"),
    });
    await AppDataSource.getRepository(Article).save({
      storyId: story.id,
      storyAssignmentStatus: "auto_accepted" as const,
      publisherId: publisher.id,
      title: "Fab announces new line",
      url: "https://sector-wire.example/fab-line",
      analysisText: "A new packaging line.",
      analysisTextMode: "manual_fixture",
      publishedAt: new Date("2026-01-02T00:00:00Z"),
    });

    const res = await request(app()).get("/api/v1/dashboard/investor").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.sectors).toContainEqual({ category: "technology", storyCount: 1, articleCount: 1 });
  });

  // #56: the Investor surface's way into the consensus/contradiction reading. The
  // register promises a Story that *can* be read comparatively, so it applies the
  // same eligibility the generation endpoint applies — accepted membership, analysis
  // text, an embedding — and the same minimum of two distinct Publishers.
  it("registers the Stories an Investor can read comparatively, and only those", async () => {
    const token = await registerAndLogin("investor-comparable@example.com", "investor");
    const one = await createPublisher("comparable-one.example");
    const two = await createPublisher("comparable-two.example");

    const comparable = await createStory("compare-two-outlets", "Interconnector timetable slips");
    await createMember({ storyId: comparable.id, publisherId: one.id, title: "Timetable slips to 2029" });
    await createMember({ storyId: comparable.id, publisherId: two.id, title: "Operator confirms new date" });

    // Newest movement first: an Investor reads what moved this morning, and the
    // register is capped, so the ordering decides what reaches the page at all.
    const older = await createStory("compare-older", "Earlier comparable Story");
    await AppDataSource.getRepository(Story).update(older.id, { lastSeenAt: new Date("2026-01-03T00:00:00Z") });
    await createMember({ storyId: older.id, publisherId: one.id, title: "First filing on the older story" });
    await createMember({ storyId: older.id, publisherId: two.id, title: "Second filing on the older story" });

    // One newsroom is not a comparison, whatever it filed.
    const alone = await createStory("compare-one-outlet", "Single outlet on the tariff review");
    await createMember({ storyId: alone.id, publisherId: one.id, title: "Tariff review opens" });
    await createMember({ storyId: alone.id, publisherId: one.id, title: "Tariff review continues" });

    // A proposal is a machine's guess (#50): it cannot ground a claim, so it cannot
    // make a second publisher either.
    const proposed = await createStory("compare-pending", "Second outlet only proposed");
    await createMember({ storyId: proposed.id, publisherId: one.id, title: "First word on the audit" });
    await createMember({
      storyId: proposed.id,
      publisherId: two.id,
      title: "Possibly the same audit",
      status: "pending_review",
    });

    // Fails closed exactly where evidence selection does: with no vector Tessera
    // cannot tell an independent newsroom from the same wire report twice (#54).
    const unembedded = await createStory("compare-unembedded", "Awaiting the next clustering run");
    await createMember({ storyId: unembedded.id, publisherId: one.id, title: "Filed but unembedded", embedded: false });
    await createMember({ storyId: unembedded.id, publisherId: two.id, title: "Also unembedded", embedded: false });

    const res = await request(app()).get("/api/v1/dashboard/investor").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.comparableStories).toContainEqual({
      id: comparable.id,
      title: "Interconnector timetable slips",
      category: "technology",
      publisherCount: 2,
      lastSeenAt: comparable.lastSeenAt.toISOString(),
    });
    const listed = res.body.comparableStories.map((story: { id: string }) => story.id);
    expect(listed.indexOf(comparable.id)).toBeLessThan(listed.indexOf(older.id));
    expect(listed).not.toContain(alone.id);
    expect(listed).not.toContain(proposed.id);
    expect(listed).not.toContain(unembedded.id);
  });

  // requireAuth resolves identity and role from the users row, not the token's
  // claims, so a 24h token stops carrying authority the moment the row changes.
  it("stops honouring a token once its user is deleted", async () => {
    const email = "deleted-dash@example.com";
    const token = await registerAndLogin(email, "student");
    await AppDataSource.getRepository(User).delete({ email });

    const res = await request(app()).get("/api/v1/dashboard/student").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it("authorises off the stored role, not the role the token was signed with", async () => {
    const email = "demoted-dash@example.com";
    const token = await registerAndLogin(email, "student");
    await AppDataSource.getRepository(User).update({ email }, { role: "investor" });

    const stale = await request(app()).get("/api/v1/dashboard/student").set("Authorization", `Bearer ${token}`);
    expect(stale.status).toBe(403);

    const current = await request(app()).get("/api/v1/dashboard/investor").set("Authorization", `Bearer ${token}`);
    expect(current.status).toBe(200);
  });

  it("lets an Admin read the Admin dashboard's role counts and blocks Student/Investor", async () => {
    await registerAndLogin("admin-count-student@example.com", "student");
    await registerAndLogin("admin-count-investor@example.com", "investor");
    const token = await createAdminToken("admin-dash@example.com");

    const own = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body.role).toBe("admin");
    expect(own.body.userCounts.student).toBeGreaterThanOrEqual(1);
    expect(own.body.userCounts.investor).toBeGreaterThanOrEqual(1);
    expect(own.body.userCounts.admin).toBeGreaterThanOrEqual(1);

    const student = await request(app()).get("/api/v1/dashboard/student").set("Authorization", `Bearer ${token}`);
    expect(student.status).toBe(403);

    const investor = await request(app()).get("/api/v1/dashboard/investor").set("Authorization", `Bearer ${token}`);
    expect(investor.status).toBe(403);
  });

  // Story 12: the Admin dashboard is an operator surface over seeded connectors
  // and publishers, not just a user-count readout.
  it("lists seeded connectors and publishers for an Admin", async () => {
    const token = await createAdminToken("admin-operator@example.com");
    await AppDataSource.getRepository(IngestionConnector).save({
      name: "Operator RSS",
      kind: "rss",
      endpoint: "https://operator.example/feed.xml",
      enabled: false,
    });
    const publisher = await AppDataSource.getRepository(Publisher).save({
      name: "Operator Press",
      domain: "operator-press.example",
    });

    const res = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.connectors).toContainEqual(
      expect.objectContaining({ name: "Operator RSS", kind: "rss", enabled: false }),
    );
    expect(res.body.publishers).toContainEqual({
      id: publisher.id,
      name: "Operator Press",
      domain: "operator-press.example",
      // Story 20: an operator can see which sources are cleared, and this one is
      // at the fail-closed default (#40).
      termsClass: "internal_only",
      articleCount: 0,
    });
  });
});
