import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("tessera_test")
    .withUsername("tessera")
    .withPassword("tessera")
    .start();

  AppDataSource.setOptions({ url: container.getConnectionUri() });
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
}, 60_000);

afterAll(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  if (container) await container.stop();
});

const app = () => createApp();

describe("POST /api/v1/auth/register", () => {
  it("registers a new Student and returns a token", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "student@example.com", password: "correct-horse", role: "student" });

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: "student@example.com", role: "student" });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a duplicate email with 409", async () => {
    await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "dupe@example.com", password: "correct-horse", role: "student" });

    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "dupe@example.com", password: "another-password", role: "investor" });

    expect(res.status).toBe(409);
  });

  it("rejects an invalid email with 422", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", password: "correct-horse", role: "student" });

    expect(res.status).toBe(422);
  });

  it("rejects a weak password with 422", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "weak@example.com", password: "short", role: "student" });

    expect(res.status).toBe(422);
  });

  it("rejects an invalid role with 422", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "admin-attempt@example.com", password: "correct-horse", role: "admin" });

    expect(res.status).toBe(422);
  });
});

describe("POST /api/v1/auth/login", () => {
  it("logs in with correct credentials and returns a token", async () => {
    await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "login-ok@example.com", password: "correct-horse", role: "investor" });

    const res = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "login-ok@example.com", password: "correct-horse" });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: "login-ok@example.com", role: "investor" });
  });

  it("rejects wrong password with 401", async () => {
    await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "login-bad@example.com", password: "correct-horse", role: "student" });

    const res = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "login-bad@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  it("rejects an unknown email with 401", async () => {
    const res = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "correct-horse" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("rejects a request with no token with 401", async () => {
    const res = await request(app()).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed token with 401", async () => {
    const res = await request(app()).get("/api/v1/auth/me").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
  });

  it("rejects an expired token with 401", async () => {
    const expired = jwt.sign({ sub: "some-id", role: "student" }, "test-secret", { expiresIn: -1 });
    const res = await request(app()).get("/api/v1/auth/me").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("returns the current user for a valid token", async () => {
    const registerRes = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "me@example.com", password: "correct-horse", role: "student" });

    const res = await request(app())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${registerRes.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: "me@example.com", role: "student" });
  });
});
