import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
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
});

afterAll(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  if (container) await container.stop();
});

describe("GET /api/v1/health", () => {
  it("returns 200 with a live database round-trip", async () => {
    const res = await request(createApp()).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", db: "ok" });
  });
});
