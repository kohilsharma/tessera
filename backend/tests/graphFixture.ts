import bcrypt from "bcryptjs";
import { expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { signToken } from "../src/auth/jwt";
import { Article } from "../src/entities/Article";
import type { GkgAnnotationKind } from "../src/entities/GkgAnnotation";
import { Publisher, type TermsClass } from "../src/entities/Publisher";
import { User } from "../src/entities/User";
import { stageAnnotations } from "../src/ingestion/runConnector";

// The graph's fixture, shared by #68's global view and #69's neighbourhood. One
// generator because the two surfaces read one graph through one read path
// (src/graph/loadGraphView.ts): two fixtures would be two chances for one of them to
// agree with itself about a shape the other never sees.
//
// The pass (#66) is the generator throughout — a graph assembled by hand would let a
// test agree with itself about a shape the pass never produces.

export async function createPublisher(domain: string, termsClass?: TermsClass): Promise<Publisher> {
  return AppDataSource.getRepository(Publisher).save({ domain, name: domain, termsClass });
}

// One Article per hour from a fixed origin, so the window a graph states is a fact the
// fixture knows rather than one the test recomputes with the same SQL under test.
// `metadata_only` because ADR-0028's graph is built over firehose metadata.
let nextArticle = 0;
export async function createArticle(
  publisherId: string,
  title: string,
  overrides: Partial<Article> = {},
): Promise<Article> {
  nextArticle += 1;
  return AppDataSource.getRepository(Article).save({
    publisherId,
    title,
    url: `https://${nextArticle}.example/story`,
    analysisText: null,
    analysisTextMode: "metadata_only",
    publishedAt: new Date(Date.UTC(2026, 7, 25, nextArticle)),
    ...overrides,
  });
}

let nextOffset = 0;
export async function annotate(
  articleId: string,
  names: string[],
  kind: GkgAnnotationKind = "person",
): Promise<void> {
  await stageAnnotations(
    AppDataSource.manager,
    articleId,
    names.map((surfaceName) => {
      nextOffset += 1;
      return { kind, surfaceName, charOffset: nextOffset, locationDetail: null };
    }),
  );
}

// `count` Articles each naming every one of `names`: the floor counts distinct Articles,
// so this is both how a name is promoted and how a pair earns its weight.
export async function coMention(
  publisherId: string,
  names: string[],
  count: number,
  label = names.join("+"),
): Promise<Article[]> {
  const created: Article[] = [];
  for (let index = 0; index < count; index += 1) {
    const article = await createArticle(publisherId, `${label} ${index}`);
    await annotate(article.id, names);
    created.push(article);
  }
  return created;
}

// More names than a view will draw, all at identical presence, each pair co-mentioned in
// every Article: the fixture a node bound is argued against. Fixed-width digits so the
// names are far enough apart in trigram space that the pass does not fold any of them
// into another (#67's automatic bar is 0.90).
export function crowdNames(size: number, prefix = "Crowd"): string[] {
  return Array.from({ length: size }, (_, index) => `${prefix} ${String(index).padStart(2, "0")}`);
}

// Users outlive the truncation between tests, so each reader registers under its own
// address. The token is asserted here rather than at the call sites: without it every
// later assertion fails as a 401, which reads as a broken route rather than a broken
// fixture.
let nextReader = 0;
export async function reader(role: "student" | "investor"): Promise<string> {
  nextReader += 1;
  const res = await request(createApp())
    .post("/api/v1/auth/register")
    .send({ email: `${role}.${nextReader}@tessera.local`, password: "correct-horse", role });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

export async function adminToken(): Promise<string> {
  const passwordHash = await bcrypt.hash("correct-horse", 10);
  nextReader += 1;
  const user = await AppDataSource.getRepository(User).save({
    email: `admin.${nextReader}@tessera.local`,
    passwordHash,
    role: "admin",
  });
  return signToken({ sub: user.id, role: user.role });
}

// Everything the pass reads or writes, plus the Articles and Stories it reads them off.
export async function truncateGraph(): Promise<void> {
  await AppDataSource.query(
    `TRUNCATE "articles", "publishers", "stories", "entities", "entity_edges",
              "entity_resolution_runs", "entity_aliases", "entity_merge_refusals" CASCADE`,
  );
}
