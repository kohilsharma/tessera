import "reflect-metadata";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

describe("initial migration", () => {
  it("installs the pgvector extension", async () => {
    const rows = await AppDataSource.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");

    expect(rows).toHaveLength(1);
  });
});

describe("GET /api/v1/health", () => {
  it("returns 200 with a live database round-trip", async () => {
    const res = await request(createApp()).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "ok" });
  });
});
