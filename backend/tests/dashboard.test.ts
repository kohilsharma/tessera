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
