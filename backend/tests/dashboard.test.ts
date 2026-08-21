import "reflect-metadata";
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { User } from "../src/entities/User";
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

    const own = await request(app()).get("/api/v1/dashboard/student").set("Authorization", `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ role: "student", studyCollections: [] });

    const investor = await request(app()).get("/api/v1/dashboard/investor").set("Authorization", `Bearer ${token}`);
    expect(investor.status).toBe(403);

    const admin = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);
    expect(admin.status).toBe(403);
  });

  it("lets an Investor read the Investor dashboard and blocks Student/Admin", async () => {
    const token = await registerAndLogin("investor-dash@example.com", "investor");

    const own = await request(app()).get("/api/v1/dashboard/investor").set("Authorization", `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ role: "investor", watchlist: [] });

    const student = await request(app()).get("/api/v1/dashboard/student").set("Authorization", `Bearer ${token}`);
    expect(student.status).toBe(403);

    const admin = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);
    expect(admin.status).toBe(403);
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
});
