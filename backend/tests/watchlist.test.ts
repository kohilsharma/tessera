import "reflect-metadata";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

async function token(email: string) {
  const response = await request(createApp()).post("/api/v1/auth/register").send({ email, password: "correct-horse", role: "investor" });
  return response.body.token as string;
}

describe("investor watchlist", () => {
  it("creates, lists and removes owned Tickers", async () => {
    const investor = await token("watchlist-owner@example.com");
    const created = await request(createApp()).post("/api/v1/watchlist").set("Authorization", `Bearer ${investor}`).send({ kind: "ticker", value: " aapl " });
    expect(created.status).toBe(201);
    expect(created.body.value).toBe("AAPL");

    const listed = await request(createApp()).get("/api/v1/watchlist").set("Authorization", `Bearer ${investor}`);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({ kind: "ticker", value: "AAPL" });

    const removed = await request(createApp()).delete(`/api/v1/watchlist/${created.body.id}`).set("Authorization", `Bearer ${investor}`);
    expect(removed.status).toBe(204);
    expect((await request(createApp()).get("/api/v1/watchlist").set("Authorization", `Bearer ${investor}`)).body.items).toEqual([]);
  });

  it("accepts sectors, rejects duplicates and blocks other roles", async () => {
    const investor = await token("watchlist-sector@example.com");
    const first = await request(createApp()).post("/api/v1/watchlist").set("Authorization", `Bearer ${investor}`).send({ kind: "sector", value: "Technology" });
    expect(first.status).toBe(201);
    expect((await request(createApp()).post("/api/v1/watchlist").set("Authorization", `Bearer ${investor}`).send({ kind: "sector", value: "technology" })).status).toBe(409);
    expect((await request(createApp()).post("/api/v1/watchlist").set("Authorization", `Bearer ${investor}`).send({ kind: "ticker", value: "bad ticker" })).status).toBe(422);

    const student = await request(createApp()).post("/api/v1/auth/register").send({ email: "watchlist-student@example.com", password: "correct-horse", role: "student" });
    expect((await request(createApp()).get("/api/v1/watchlist").set("Authorization", `Bearer ${student.body.token}`)).status).toBe(403);
  });
});
