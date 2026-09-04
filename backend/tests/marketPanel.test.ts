import "reflect-metadata";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { signToken } from "../src/auth/jwt";
import { AppDataSource } from "../src/data-source";
import { Article } from "../src/entities/Article";
import { Entity } from "../src/entities/Entity";
import { GkgAnnotation } from "../src/entities/GkgAnnotation";
import { Publisher } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { User } from "../src/entities/User";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

const app = () => createApp();

async function token(role: "student" | "investor"): Promise<string> {
  const user = await AppDataSource.getRepository(User).save({
    email: `${role}@market.example`,
    passwordHash: "unused",
    role,
  });
  return signToken({ sub: user.id, role });
}

beforeEach(async () => {
  await AppDataSource.query(`TRUNCATE "gkg_annotations", "articles", "publishers", "stories", "entities", "users" CASCADE`);
});

async function createStory(ticker: string | null): Promise<string> {
  const publisher = await AppDataSource.getRepository(Publisher).save({ name: "Market Wire", domain: "market.example" });
  const story = await AppDataSource.getRepository(Story).save({
    slug: "market-story",
    title: "Market story",
    summary: null,
    category: "technology",
    firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-01-01T00:00:00Z"),
  });
  const article = await AppDataSource.getRepository(Article).save({
    storyId: story.id,
    storyAssignmentStatus: "auto_accepted" as const,
    publisherId: publisher.id,
    title: "Market report",
    url: "https://market.example/report",
    analysisText: null,
    analysisTextMode: "metadata_only",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const entity = await AppDataSource.getRepository(Entity).save({
    kind: "organization",
    canonicalName: "NVIDIA Corporation",
    normalizedName: "nvidia corporation",
    featureId: null,
    ticker,
  });
  await AppDataSource.getRepository(GkgAnnotation).save({
    articleId: article.id,
    kind: "organization",
    surfaceName: "NVIDIA Corporation",
    charOffset: 0,
    locationDetail: null,
  });
  expect(entity.ticker).toBe(ticker);
  return story.id;
}

describe("Story market panel", () => {
  it("serves a quoted series and indicators to Investors", async () => {
    const storyId = await createStory("NVDA");
    const response = await request(app()).get(`/api/v1/stories/${storyId}`).set("Authorization", `Bearer ${await token("investor")}`);

    expect(response.status).toBe(200);
    expect(response.body.marketStatus).toBe("ready");
    expect(response.body.marketTotal).toBe(1);
    expect(response.body.market).toHaveLength(1);
    expect(response.body.market[0]).toEqual(
      expect.objectContaining({
        entity: expect.objectContaining({ canonicalName: "NVIDIA Corporation", ticker: "NVDA" }),
        quote: expect.objectContaining({ ticker: "NVDA", source: "mock" }),
        indicators: expect.objectContaining({ sma50: expect.any(Number), rsi14: expect.any(Number), volatility: expect.any(Number) }),
      }),
    );
    expect(response.body.market[0].series.length).toBeGreaterThanOrEqual(252);
  });

  it("does not expose the Investor panel to another role", async () => {
    const storyId = await createStory("NVDA");
    const response = await request(app()).get(`/api/v1/stories/${storyId}`).set("Authorization", `Bearer ${await token("student")}`);

    expect(response.status).toBe(200);
    expect(response.body.market).toBeUndefined();
    expect(response.body.marketStatus).toBeUndefined();
  });

  it("returns an honest empty market when no organization carries a Ticker", async () => {
    const storyId = await createStory(null);
    const response = await request(app()).get(`/api/v1/stories/${storyId}`).set("Authorization", `Bearer ${await token("investor")}`);

    expect(response.status).toBe(200);
    expect(response.body.market).toBeNull();
    expect(response.body.marketStatus).toBe("empty");
    expect(response.body.marketTotal).toBe(0);
  });
});
