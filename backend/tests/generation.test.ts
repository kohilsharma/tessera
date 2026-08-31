import "reflect-metadata";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { signToken } from "../src/auth/jwt";
import { EMBEDDING_DIMENSIONS } from "../src/embeddings/EmbeddingProvider";
import { toVectorLiteral } from "../src/embeddings/pgvector";
import { Article, type AnalysisTextMode, type StoryAssignmentStatus } from "../src/entities/Article";
import { Publisher, type TermsClass } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { User, type UserRole } from "../src/entities/User";
import { EXCERPT_CHARS, MAX_ARTICLES_PER_PUBLISHER, MAX_EVIDENCE_ARTICLES, PROMPT_VERSION } from "../src/generation/config";
import { MockSynthesisProvider } from "../src/synthesis/MockSynthesisProvider";
import type { SynthesisProvider, SynthesisRequest } from "../src/synthesis";
import { setupTestDb } from "./setupTestDb";

// The generation endpoint is synchronous, so unlike clustering the HTTP seam drives
// the whole pipeline — selection, freezing, the provider call, validation and
// persistence are one request. The one thing stubbed is the SynthesisProvider, which
// is where a captured bad answer enters: every refusal below is driven by output of
// the kind a cheap model actually produces, with no network and no key.
const { synth } = vi.hoisted(() => ({
  synth: { provider: null as SynthesisProvider | null, requests: [] as SynthesisRequest[] },
}));
vi.mock("../src/synthesis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/synthesis")>()),
  createSynthesisProvider: () => ({
    complete: async (req: SynthesisRequest) => {
      synth.requests.push(req);
      if (!synth.provider) throw new Error("This test configured no synthesis provider");
      return synth.provider.complete(req);
    },
  }),
}));

setupTestDb();

const app = () => createApp();

// Answers in order; running out means the endpoint called the provider more often
// than the test expected, which is the whole assertion for reuse.
function answering(...answers: (string | Error)[]): void {
  let served = 0;
  synth.provider = {
    complete: async () => {
      const answer = answers[served];
      served += 1;
      if (answer === undefined) throw new Error(`the provider had no answer for call ${served}`);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const claimsAnswer = (...claims: unknown[]) => JSON.stringify({ claims });
const consensus = (citations: string[], text = "Every outlet reports the same pilot target.") => ({
  text,
  claim_type: "consensus",
  citations,
});

// Vectors are the fixture, exactly as they are in tests/clustering.test.ts: an axis
// vector per plane, so "this Article is about something else" is a statement about
// geometry rather than a hope about a real model.
function axisVector(plane: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[plane] = 1;
  return vector;
}

let nextArticle = 0;

async function createPublisher(domain: string, termsClass: TermsClass = "licensed"): Promise<Publisher> {
  return AppDataSource.getRepository(Publisher).save({ domain, name: domain, termsClass });
}

async function createStory(title = "Pilot line"): Promise<Story> {
  nextArticle += 1;
  return AppDataSource.getRepository(Story).save({
    slug: `story-${nextArticle}`,
    title,
    summary: null,
    category: "technology",
    firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-01-09T00:00:00Z"),
  });
}

async function createArticle(fields: {
  storyId: string | null;
  publisherId: string;
  title: string;
  text?: string | null;
  mode?: AnalysisTextMode;
  assignmentStatus?: StoryAssignmentStatus;
  publishedAt?: Date;
  vector?: number[];
}): Promise<Article> {
  nextArticle += 1;
  const article = await AppDataSource.getRepository(Article).save({
    storyId: fields.storyId,
    storyAssignmentStatus: fields.storyId ? (fields.assignmentStatus ?? "auto_accepted") : null,
    storyAssignmentScore: fields.storyId ? 0.95 : null,
    publisherId: fields.publisherId,
    title: fields.title,
    url: `https://${nextArticle}.example/report`,
    analysisText: fields.text === undefined ? `${fields.title} body text` : fields.text,
    analysisTextMode: fields.mode ?? "manual_fixture",
    publishedAt: fields.publishedAt ?? new Date("2026-01-04T00:00:00Z"),
  });
  await AppDataSource.query(`UPDATE "articles" SET "embedding" = $1::vector WHERE "id" = $2`, [
    toVectorLiteral(fields.vector ?? axisVector(0)),
    article.id,
  ]);
  return article;
}

async function tokenFor(role: UserRole): Promise<string> {
  nextArticle += 1;
  const user = await AppDataSource.getRepository(User).save({
    email: `${role}-${nextArticle}@tessera.example`,
    passwordHash: await bcrypt.hash("correct-horse", 10),
    role,
  });
  return signToken({ sub: user.id, role: user.role });
}

function requestAnalysis(storyId: string, token: string, body?: Record<string, unknown>) {
  return request(app())
    .post(`/api/v1/stories/${storyId}/analysis`)
    .set("Authorization", `Bearer ${token}`)
    .send(body ?? {});
}

// A Story two Publishers reported, which is the shape everything below starts from.
async function twoPublisherStory(): Promise<{ story: Story; first: Article; second: Article }> {
  const story = await createStory();
  const one = await createPublisher(`one-${(nextArticle += 1)}.example`);
  const two = await createPublisher(`two-${(nextArticle += 1)}.example`);
  const first = await createArticle({
    storyId: story.id,
    publisherId: one.id,
    title: "Pilot line targets 2027 output",
    publishedAt: new Date("2026-01-02T00:00:00Z"),
  });
  const second = await createArticle({
    storyId: story.id,
    publisherId: two.id,
    title: "Subsidy timing still unresolved",
    publishedAt: new Date("2026-01-08T00:00:00Z"),
  });
  return { story, first, second };
}

beforeEach(async () => {
  await AppDataSource.query(
    `TRUNCATE "articles", "publishers", "stories", "users", "evidence_sets", "generation_runs" CASCADE`,
  );
  synth.requests.length = 0;
  // ADR-0003's Mock is the default provider, so every test that is not about a
  // specific bad answer runs the no-key path.
  synth.provider = new MockSynthesisProvider();
});

// ADR-0002's invariant, asserted for every claim the suite ever persists rather than
// only where a test thought to look: a persisted claim cites at least one evidence id,
// and every citation resolves to a row of its own run's frozen EvidenceSet.
afterEach(async () => {
  const ungrounded = await AppDataSource.query(
    `SELECT c."id" FROM "analysis_claims" c
      WHERE NOT EXISTS (
        SELECT 1 FROM "claim_evidence" ce
          JOIN "generation_runs" r ON r."id" = c."generationRunId"
          JOIN "evidence_set_articles" esa ON esa."evidenceSetId" = r."evidenceSetId"
            AND esa."evidenceId" = ce."evidenceId" AND esa."articleId" = ce."articleId"
         WHERE ce."claimId" = c."id")`,
  );
  expect(ungrounded).toEqual([]);

  // Generation's ledger, the counterpart of a Clustering Run's: what the model
  // returned is what was kept plus what was refused.
  const offenders = await AppDataSource.query(
    `SELECT "id" FROM "generation_runs"
      WHERE "validationResult" IS NOT NULL
        AND ("validationResult"->>'claimsAccepted')::int + ("validationResult"->>'claimsRejected')::int
            <> ("validationResult"->>'claimsReturned')::int`,
  );
  expect(offenders).toEqual([]);
});

describe("evidence selection", () => {
  it("ranks by distance to the Story centroid, bounded at ten Articles", async () => {
    const story = await createStory();
    // Six Publishers so the per-publisher cap is not what limits this set, and one
    // Article whose vector points somewhere else entirely — neither the earliest nor
    // the latest, so only its distance decides whether it is in.
    for (let index = 0; index < 6; index += 1) {
      const publisher = await createPublisher(`ranked-${index}.example`);
      for (const half of [0, 1]) {
        await createArticle({
          storyId: story.id,
          publisherId: publisher.id,
          title: `on topic ${index}-${half}`,
          publishedAt: new Date(Date.UTC(2026, 0, 3 + index, half)),
        });
      }
    }
    const publisher = await createPublisher("off-topic.example");
    const offTopic = await createArticle({
      storyId: story.id,
      publisherId: publisher.id,
      title: "unrelated reporting",
      publishedAt: new Date("2026-01-05T12:00:00Z"),
      vector: axisVector(7),
    });

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.status).toBe(200);
    expect(res.body.evidence).toHaveLength(MAX_EVIDENCE_ARTICLES);
    expect(res.body.articleCount).toBe(MAX_EVIDENCE_ARTICLES);
    expect(res.body.evidence.map((row: { articleId: string }) => row.articleId)).not.toContain(offTopic.id);
    // A1 is the closest reporting, and the ids run in rank order.
    expect(res.body.evidence.map((row: { evidenceId: string }) => row.evidenceId)).toEqual(
      Array.from({ length: MAX_EVIDENCE_ARTICLES }, (_, index) => `A${index + 1}`),
    );
    expect(res.body.evidence.map((row: { sourceRank: number }) => row.sourceRank)).toEqual(
      [...res.body.evidence.map((row: { sourceRank: number }) => row.sourceRank)].sort((a, b) => a - b),
    );
  });

  it("forces the earliest and latest reporting in even when it ranks last", async () => {
    const story = await createStory();
    const core = await createPublisher("core.example");
    const edges = await createPublisher("edges.example");
    for (let index = 0; index < 10; index += 1) {
      await createArticle({
        storyId: story.id,
        publisherId: await createPublisher(`filler-${index}.example`).then((p) => p.id),
        title: `filler ${index}`,
        publishedAt: new Date(Date.UTC(2026, 0, 5, index)),
      });
    }
    await createArticle({ storyId: story.id, publisherId: core.id, title: "core", vector: axisVector(0) });
    // Both ends of the coverage window point away from the centroid, so ranking alone
    // would never reach them.
    const earliest = await createArticle({
      storyId: story.id,
      publisherId: edges.id,
      title: "first word on it",
      publishedAt: new Date("2026-01-01T00:00:00Z"),
      vector: axisVector(9),
    });
    const latest = await createArticle({
      storyId: story.id,
      publisherId: edges.id,
      title: "last word on it",
      publishedAt: new Date("2026-01-20T00:00:00Z"),
      vector: axisVector(9),
    });

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    const reasons = new Map<string, string>(
      res.body.evidence.map((row: { articleId: string; selectionReason: string }) => [
        row.articleId,
        row.selectionReason,
      ]),
    );
    expect(reasons.get(earliest.id)).toBe("earliest_reporting");
    expect(reasons.get(latest.id)).toBe("latest_reporting");
    expect(res.body.evidence).toHaveLength(MAX_EVIDENCE_ARTICLES);
  });

  it("takes at most two Articles per Publisher, so one masthead cannot carry a set", async () => {
    const story = await createStory();
    const loud = await createPublisher("loud.example");
    for (let index = 0; index < 5; index += 1) {
      await createArticle({
        storyId: story.id,
        publisherId: loud.id,
        title: `loud ${index}`,
        publishedAt: new Date(Date.UTC(2026, 0, 4, index)),
      });
    }
    const quiet = await createPublisher("quiet.example");
    await createArticle({
      storyId: story.id,
      publisherId: quiet.id,
      title: "quiet",
      publishedAt: new Date("2026-01-09T00:00:00Z"),
    });

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    const fromLoud = res.body.evidence.filter(
      (row: { publisher: { domain: string } }) => row.publisher.domain === "loud.example",
    );
    expect(fromLoud).toHaveLength(MAX_ARTICLES_PER_PUBLISHER);
    expect(res.body.distinctPublisherCount).toBe(2);
  });

  it("excludes pending assignments, Unclustered Articles and members with no text", async () => {
    const { story, first, second } = await twoPublisherStory();
    const other = await createPublisher("other.example");
    const proposed = await createArticle({
      storyId: story.id,
      publisherId: other.id,
      title: "borderline proposal",
      assignmentStatus: "pending_review",
    });
    const unclustered = await createArticle({ storyId: null, publisherId: other.id, title: "unclustered" });
    const textless = await createArticle({
      storyId: story.id,
      publisherId: other.id,
      title: "firehose row",
      text: null,
      mode: "metadata_only",
    });
    // Present but empty is the same nothing: an evidence id backed by no text would
    // still be citable.
    const blank = await createArticle({
      storyId: story.id,
      publisherId: other.id,
      title: "empty body",
      text: "   \n  ",
    });

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    const ids = res.body.evidence.map((row: { articleId: string }) => row.articleId);
    expect(ids.sort()).toEqual([first.id, second.id].sort());
    for (const excluded of [proposed.id, unclustered.id, textless.id, blank.id]) {
      expect(ids).not.toContain(excluded);
    }
  });

  it("freezes a stable evidence id, a deterministic excerpt and a hash of the full text", async () => {
    const story = await createStory();
    const publisher = await createPublisher("long.example");
    const body = `Opening sentence. ${"detail ".repeat(600)}closing sentence.`;
    const article = await createArticle({
      storyId: story.id,
      publisherId: publisher.id,
      title: "long report",
      text: body,
    });
    await createArticle({
      storyId: story.id,
      publisherId: await createPublisher("short.example").then((p) => p.id),
      title: "short report",
      text: "  Two   publishers   reported\nit.  ",
      publishedAt: new Date("2026-01-06T00:00:00Z"),
    });

    await requestAnalysis(story.id, await tokenFor("student"));

    const frozen: {
      evidenceId: string;
      articleContentHash: string;
      includedExcerptSnapshot: string;
      selectionReason: string;
    }[] = await AppDataSource.query(
      `SELECT "evidenceId", "articleContentHash", "includedExcerptSnapshot", "selectionReason"
         FROM "evidence_set_articles" WHERE "articleId" = $1`,
      [article.id],
    );
    expect(frozen).toHaveLength(1);
    // The hash is over the whole body, not the excerpt that was sent (ADR-0027): a
    // body replaced underneath an identical opening must not look unchanged.
    expect(frozen[0].articleContentHash).toBe(createHash("sha256").update(body).digest("hex"));
    expect(frozen[0].includedExcerptSnapshot).not.toBe(body);
    expect(frozen[0].includedExcerptSnapshot.length).toBeLessThanOrEqual(EXCERPT_CHARS + 1);
    expect(frozen[0].includedExcerptSnapshot.startsWith("Opening sentence.")).toBe(true);

    const short: { includedExcerptSnapshot: string }[] = await AppDataSource.query(
      `SELECT esa."includedExcerptSnapshot" FROM "evidence_set_articles" esa
         JOIN "articles" a ON a."id" = esa."articleId" WHERE a."title" = 'short report'`,
    );
    expect(short[0].includedExcerptSnapshot).toBe("Two publishers reported it.");
  });

  it("renders the provenance frozen before the provider answered", async () => {
    const { story, first } = await twoPublisherStory();
    const publisher = await AppDataSource.getRepository(Publisher).findOneByOrFail({ id: first.publisherId });
    const original = {
      title: first.title,
      url: first.url,
      publishedAt: first.publishedAt.toISOString(),
      publisherName: publisher.name,
      publisherDomain: publisher.domain,
    };
    synth.provider = {
      complete: async () => {
        await AppDataSource.query(
          `UPDATE "articles" SET "title" = 'changed title', "url" = 'https://changed.example/report',
                  "publishedAt" = '2026-01-03T00:00:00Z' WHERE "id" = $1`,
          [first.id],
        );
        await AppDataSource.query(
          `UPDATE "publishers" SET "name" = 'Changed Publisher', "domain" = 'changed.example' WHERE "id" = $1`,
          [publisher.id],
        );
        return claimsAnswer(consensus(["A1", "A2"]));
      },
    };

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    const frozen = res.body.evidence.find((row: { articleId: string }) => row.articleId === first.id);
    expect(frozen).toMatchObject({
      title: original.title,
      url: original.url,
      publisher: { id: publisher.id, name: original.publisherName, domain: original.publisherDomain },
    });
    expect(new Date(frozen.publishedAt).toISOString()).toBe(original.publishedAt);
  });

  it("refuses a Story with no reporting to cite", async () => {
    const story = await createStory();
    const publisher = await createPublisher("silent.example");
    await createArticle({
      storyId: story.id,
      publisherId: publisher.id,
      title: "metadata only",
      text: null,
      mode: "metadata_only",
    });

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no reporting/i);
    expect(synth.requests).toHaveLength(0);
  });
});

describe("the Lens", () => {
  it("is derived from the caller's role", async () => {
    const { story } = await twoPublisherStory();

    const student = await requestAnalysis(story.id, await tokenFor("student"));
    const investor = await requestAnalysis(story.id, await tokenFor("investor"));

    expect(student.body.lens).toBe("student_context");
    expect(investor.body.lens).toBe("investor_implication");
    // One Lens per run (ADR-0010), and the prompt says which — so the two roles are
    // asking different questions of the same frozen evidence, not the same one twice.
    expect(synth.requests[0].prompt).toContain("student_context");
    expect(synth.requests[0].prompt).not.toContain("investor_implication");
    expect(synth.requests[1].prompt).toContain("investor_implication");
  });

  it("cannot be chosen by a reader", async () => {
    const { story } = await twoPublisherStory();

    const res = await requestAnalysis(story.id, await tokenFor("student"), { lens: "investor_implication" });

    expect(res.status).toBe(422);
    expect(synth.requests).toHaveLength(0);
  });

  it("must be named by an Admin, who belongs to neither audience", async () => {
    const { story } = await twoPublisherStory();
    const admin = await tokenFor("admin");

    const unnamed = await requestAnalysis(story.id, admin);
    const named = await requestAnalysis(story.id, admin, { lens: "investor_implication" });
    const nonsense = await requestAnalysis(story.id, admin, { lens: "shareholder_vibes" });

    expect(unnamed.status).toBe(422);
    expect(nonsense.status).toBe(422);
    expect(named.status).toBe(200);
    expect(named.body.lens).toBe("investor_implication");
  });

  it("needs an identity at all", async () => {
    const { story } = await twoPublisherStory();

    const res = await request(app()).post(`/api/v1/stories/${story.id}/analysis`).send({});

    expect(res.status).toBe(401);
  });

  it("answers 404 for a Story that does not exist", async () => {
    const token = await tokenFor("student");

    expect((await requestAnalysis("2f2ad9b6-0000-4000-8000-000000000000", token)).status).toBe(404);
    expect((await requestAnalysis("not-a-uuid", token)).status).toBe(404);
  });
});

describe("citation validation", () => {
  it("completes a run whose claims all cite frozen evidence, and persists what it did", async () => {
    const { story, first } = await twoPublisherStory();
    answering(
      claimsAnswer(consensus(["A1", "A2"]), {
        text: "Only one outlet names the subsidy deadline.",
        claim_type: "source_specific",
        citations: ["A2"],
      }),
    );

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.failureCode).toBeNull();
    expect(res.body.promptVersion).toBe(PROMPT_VERSION);
    expect(res.body.claims).toHaveLength(2);
    expect(res.body.claims[0]).toMatchObject({ claimType: "consensus", citations: ["A1", "A2"] });
    // A citation is followable: the id resolves to a row of the frozen set, and that
    // row names an Article a reader can open.
    const cited = res.body.evidence.find((row: { evidenceId: string }) => row.evidenceId === "A1");
    expect(cited.articleId).toBe(first.id);

    const runs: { status: string; rawResponse: string; validationResult: Record<string, unknown> }[] =
      await AppDataSource.query(`SELECT "status", "rawResponse", "validationResult" FROM "generation_runs"`);
    expect(runs).toHaveLength(1);
    expect(runs[0].rawResponse).toContain("source_specific");
    expect(runs[0].validationResult).toMatchObject({ claimsReturned: 2, claimsAccepted: 2, claimsRejected: 0 });
  });

  it("refuses an answer whose citation names evidence outside the frozen set", async () => {
    const { story } = await twoPublisherStory();
    answering(claimsAnswer(consensus(["A1"]), consensus(["A9"], "A ninth source that was never frozen.")));

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.body.status).toBe("failed");
    expect(res.body.failureCode).toBe("invalid_citations");
    expect(res.body.claims).toEqual([]);
    // Nothing is displayed and nothing is kept, but the measurement is: this is the
    // per-run record of a model citing evidence that does not exist (ADR-0027).
    const runs: { validationResult: { unknownEvidenceIds: string[] } }[] = await AppDataSource.query(
      `SELECT "validationResult" FROM "generation_runs"`,
    );
    expect(runs[0].validationResult.unknownEvidenceIds).toEqual(["A9"]);
    expect(await AppDataSource.query(`SELECT "id" FROM "analysis_claims"`)).toEqual([]);
  });

  it("refuses a claim that cites nothing at all", async () => {
    const { story } = await twoPublisherStory();
    answering(claimsAnswer({ text: "Analysts expect consolidation.", claim_type: "consensus", citations: [] }));

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.body.failureCode).toBe("invalid_citations");
    expect(res.body.claims).toEqual([]);
  });

  it("fails the whole run on output that is not the contract", async () => {
    const { story } = await twoPublisherStory();
    const token = await tokenFor("student");

    answering("I'm sorry, I can't help with that request.");
    expect((await requestAnalysis(story.id, token)).body.failureCode).toBe("unparseable_output");

    answering(JSON.stringify({ analysis: "the story so far" }));
    expect((await requestAnalysis(story.id, token)).body.failureCode).toBe("schema_violation");

    // The other Lens is off-contract, not a claim to drop: a run carries exactly one.
    answering(
      claimsAnswer({ text: "Margins may compress.", claim_type: "investor_implication", citations: ["A1"] }),
    );
    expect((await requestAnalysis(story.id, token)).body.failureCode).toBe("schema_violation");

    expect(await AppDataSource.query(`SELECT "id" FROM "analysis_claims"`)).toEqual([]);
  });

  it("states a provider that never answered as a failed run, not as a broken request", async () => {
    const { story } = await twoPublisherStory();
    answering(new Error("429 rate limited by api.example"));

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.status).toBe(200);
    expect(res.body.failureCode).toBe("provider_error");
    // The provider's own message is for an Admin reading the row: it can name hosts.
    expect(JSON.stringify(res.body)).not.toContain("api.example");
    const runs: { failureMessage: string }[] = await AppDataSource.query(
      `SELECT "failureMessage" FROM "generation_runs"`,
    );
    expect(runs[0].failureMessage).toContain("429");
  });

  it("fails the run when an Article's text changed after its evidence was frozen", async () => {
    const { story, first } = await twoPublisherStory();
    // The provider call is exactly the window v3 §16.5 is about, so enrichment is
    // simulated inside it: the answer is about text Tessera no longer holds.
    synth.provider = {
      complete: async () => {
        await AppDataSource.query(`UPDATE "articles" SET "analysisText" = $2 WHERE "id" = $1`, [
          first.id,
          "a fuller body, extracted after the freeze",
        ]);
        return claimsAnswer(consensus(["A1", "A2"]));
      },
    };

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.body.status).toBe("failed");
    expect(res.body.failureCode).toBe("content_changed");
    expect(await AppDataSource.query(`SELECT "id" FROM "analysis_claims"`)).toEqual([]);
  });

  it("fails the run when frozen evidence left the Story while the model answered", async () => {
    const { story, first } = await twoPublisherStory();
    // A review rejection or a merge landing mid-call: the text is untouched, but the
    // set is no longer this Story's reporting.
    synth.provider = {
      complete: async () => {
        await AppDataSource.query(
          `UPDATE "articles" SET "storyId" = NULL, "storyAssignmentStatus" = NULL,
                  "storyAssignmentScore" = NULL WHERE "id" = $1`,
          [first.id],
        );
        return claimsAnswer(consensus(["A1", "A2"]));
      },
    };

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.body.failureCode).toBe("content_changed");
  });

  it("returns a claim's citations in evidence order, not by the letters of the ids", async () => {
    const story = await createStory();
    for (let index = 0; index < 10; index += 1) {
      await createArticle({
        storyId: story.id,
        publisherId: await createPublisher(`ordered-${index}.example`).then((p) => p.id),
        title: `report ${index}`,
        publishedAt: new Date(Date.UTC(2026, 0, 4, index)),
      });
    }
    answering(claimsAnswer(consensus(["A10", "A2"])));

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.body.evidence).toHaveLength(10);
    // A lexical sort would read A10 before A2.
    expect(res.body.claims[0].citations).toEqual(["A2", "A10"]);
  });
});

describe("reuse", () => {
  it("returns the existing run rather than calling the model again", async () => {
    const { story } = await twoPublisherStory();
    const token = await tokenFor("student");
    answering(claimsAnswer(consensus(["A1", "A2"])));

    const first = await requestAnalysis(story.id, token);
    const again = await requestAnalysis(story.id, token);

    expect(again.body.id).toBe(first.body.id);
    expect(again.body.reused).toBe(true);
    expect(again.body.claims).toEqual(first.body.claims);
    expect(synth.requests).toHaveLength(1);
    // One run, and no second EvidenceSet frozen for a generation that never happened.
    expect(await AppDataSource.query(`SELECT "id" FROM "evidence_sets"`)).toHaveLength(1);
  });

  it("coalesces simultaneous identical requests before calling the provider", async () => {
    const { story } = await twoPublisherStory();
    const token = await tokenFor("student");
    let markEntered!: () => void;
    let releaseProvider!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseProvider = resolve; });
    synth.provider = {
      complete: async () => {
        markEntered();
        await blocked;
        return claimsAnswer(consensus(["A1", "A2"]));
      },
    };

    const firstRequest = requestAnalysis(story.id, token).then((res) => res);
    await entered;
    const secondRequest = requestAnalysis(story.id, token).then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseProvider();
    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    expect(second.body.id).toBe(first.body.id);
    expect([first.body.reused, second.body.reused].sort()).toEqual([false, true]);
    expect(synth.requests).toHaveLength(1);
    expect(await AppDataSource.query(`SELECT "id" FROM "generation_runs"`)).toHaveLength(1);
  });

  it("coalesces simultaneous provider failures without caching the failure", async () => {
    const { story } = await twoPublisherStory();
    const token = await tokenFor("student");
    let markEntered!: () => void;
    let releaseProvider!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseProvider = resolve; });
    synth.provider = {
      complete: async () => {
        markEntered();
        await blocked;
        throw new Error("temporary provider failure");
      },
    };

    const firstRequest = requestAnalysis(story.id, token).then((res) => res);
    await entered;
    const secondRequest = requestAnalysis(story.id, token).then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseProvider();
    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    expect(second.body.id).toBe(first.body.id);
    expect(first.body.failureCode).toBe("provider_error");
    expect([first.body.reused, second.body.reused].sort()).toEqual([false, true]);
    expect(synth.requests).toHaveLength(1);
  });

  it("is per Lens, so an Investor does not read the Student's analysis", async () => {
    const { story } = await twoPublisherStory();
    answering(claimsAnswer(consensus(["A1"])), claimsAnswer(consensus(["A2"])));

    const student = await requestAnalysis(story.id, await tokenFor("student"));
    const investor = await requestAnalysis(story.id, await tokenFor("investor"));

    expect(investor.body.id).not.toBe(student.body.id);
    expect(synth.requests).toHaveLength(2);
  });

  it("does not survive the reporting changing underneath it", async () => {
    const { story, first } = await twoPublisherStory();
    const token = await tokenFor("student");
    answering(claimsAnswer(consensus(["A1", "A2"])), claimsAnswer(consensus(["A1", "A2"])));

    const before = await requestAnalysis(story.id, token);
    // Enrichment rewriting a body in place is exactly what a timestamp comparison
    // would miss, which is why the reuse key is a hash (ADR-0027).
    await AppDataSource.query(`UPDATE "articles" SET "analysisText" = $2 WHERE "id" = $1`, [
      first.id,
      "the extracted body, longer than the excerpt it replaced",
    ]);
    const after = await requestAnalysis(story.id, token);

    expect(after.body.id).not.toBe(before.body.id);
    expect(after.body.status).toBe("completed");
    expect(synth.requests).toHaveLength(2);
  });

  it("does not reuse a run when a different Article has identical text", async () => {
    const { story, first } = await twoPublisherStory();
    const token = await tokenFor("student");
    answering(claimsAnswer(consensus(["A1", "A2"])), claimsAnswer(consensus(["A1", "A2"])));

    const before = await requestAnalysis(story.id, token);
    await AppDataSource.query(
      `UPDATE "articles" SET "storyId" = NULL, "storyAssignmentStatus" = NULL,
              "storyAssignmentScore" = NULL WHERE "id" = $1`,
      [first.id],
    );
    const replacement = await createArticle({
      storyId: story.id,
      publisherId: first.publisherId,
      title: "Replacement carrying the same report",
      text: first.analysisText,
      publishedAt: first.publishedAt,
    });

    const after = await requestAnalysis(story.id, token);

    expect(after.body.id).not.toBe(before.body.id);
    expect(after.body.evidence.map((row: { articleId: string }) => row.articleId)).toContain(replacement.id);
    expect(synth.requests).toHaveLength(2);
  });

  it("does not reuse a legacy run that has no provenance snapshot", async () => {
    const { story } = await twoPublisherStory();
    const token = await tokenFor("student");
    answering(claimsAnswer(consensus(["A1", "A2"])), claimsAnswer(consensus(["A1", "A2"])));

    const legacy = await requestAnalysis(story.id, token);
    await AppDataSource.query(
      `UPDATE "evidence_set_articles" SET
        "titleSnapshot" = NULL, "urlSnapshot" = NULL, "publishedAtSnapshot" = NULL,
        "analysisTextModeSnapshot" = NULL, "publisherIdSnapshot" = NULL,
        "publisherNameSnapshot" = NULL, "publisherDomainSnapshot" = NULL
       WHERE "evidenceSetId" = (SELECT "evidenceSetId" FROM "generation_runs" WHERE "id" = $1)`,
      [legacy.body.id],
    );

    const fresh = await requestAnalysis(story.id, token);

    expect(fresh.body.id).not.toBe(legacy.body.id);
    expect(fresh.body.status).toBe("completed");
    expect(synth.requests).toHaveLength(2);
  });

  it("does not cache a failure", async () => {
    const { story } = await twoPublisherStory();
    const token = await tokenFor("student");
    answering("not json at all", claimsAnswer(consensus(["A1"])));

    const failed = await requestAnalysis(story.id, token);
    const retried = await requestAnalysis(story.id, token);

    expect(failed.body.status).toBe("failed");
    expect(retried.body.status).toBe("completed");
    expect(synth.requests).toHaveLength(2);
  });

  it("does not outlive the provider that wrote it", async () => {
    const { story } = await twoPublisherStory();
    const token = await tokenFor("student");
    answering(claimsAnswer(consensus(["A1"])), claimsAnswer(consensus(["A2"])));

    const withMock = await requestAnalysis(story.id, token);
    // The trap this closes: a demo with no key persists Mock-written claims as a
    // completed run, and configuring a key would otherwise change nothing visible.
    process.env.SYNTHESIS_PROVIDER = "openai";
    process.env.SYNTHESIS_MODEL = "some-cheap-model";
    process.env.SYNTHESIS_API_BASE = "https://configured-provider.example/v1";
    process.env.SYNTHESIS_ALLOWED_ORIGIN = "https://configured-provider.example";
    try {
      const withModel = await requestAnalysis(story.id, token);
      expect(withModel.body.id).not.toBe(withMock.body.id);
      expect(synth.requests).toHaveLength(2);
    } finally {
      delete process.env.SYNTHESIS_PROVIDER;
      delete process.env.SYNTHESIS_MODEL;
      delete process.env.SYNTHESIS_API_BASE;
      delete process.env.SYNTHESIS_ALLOWED_ORIGIN;
    }

    const providers: { provider: string; model: string }[] = await AppDataSource.query(
      `SELECT "provider", "model" FROM "generation_runs" ORDER BY "completedAt" ASC`,
    );
    expect(providers).toEqual([
      { provider: "mock", model: "mock" },
      { provider: "https://configured-provider.example", model: "some-cheap-model" },
    ]);
  });
  it("does not reuse across provider origins that share a model id", async () => {
    const { story } = await twoPublisherStory();
    const token = await tokenFor("student");
    answering(claimsAnswer(consensus(["A1"])), claimsAnswer(consensus(["A2"])));
    process.env.SYNTHESIS_PROVIDER = "openai";
    process.env.SYNTHESIS_MODEL = "shared-model";
    process.env.SYNTHESIS_API_BASE = "https://first-provider.example/v1";
    process.env.SYNTHESIS_ALLOWED_ORIGIN = "https://first-provider.example";

    try {
      const first = await requestAnalysis(story.id, token);
      process.env.SYNTHESIS_API_BASE = "https://second-provider.example/v1";
      process.env.SYNTHESIS_ALLOWED_ORIGIN = "https://second-provider.example";
      const second = await requestAnalysis(story.id, token);

      expect(second.body.id).not.toBe(first.body.id);
      expect(synth.requests).toHaveLength(2);
    } finally {
      delete process.env.SYNTHESIS_PROVIDER;
      delete process.env.SYNTHESIS_MODEL;
      delete process.env.SYNTHESIS_API_BASE;
      delete process.env.SYNTHESIS_ALLOWED_ORIGIN;
    }
  });
});

describe("the no-key path and rights", () => {
  it("produces a cited analysis through the Mock provider, including the reader's Lens", async () => {
    const { story } = await twoPublisherStory();
    synth.provider = new MockSynthesisProvider();

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(res.body.status).toBe("completed");
    expect(res.body.claims).toHaveLength(2);
    expect(res.body.claims[0]).toMatchObject({ claimType: "consensus", citations: ["A1", "A2"] });
    // The role split visible with no key at all: the Lens claim is what a Student gets
    // and an Investor does not (ADR-0004).
    expect(res.body.claims[1]).toMatchObject({ claimType: "student_context", citations: ["A1"] });
    expect(res.body.claims[0].text).toContain("[mock synthesis]");
  });

  it("survives an Article title that looks like a citation", async () => {
    const story = await createStory();
    const one = await createPublisher("bracketed.example");
    const two = await createPublisher("plain.example");
    // `[Video]`, `[Updated]` and `[Analysis]` are routine in RSS and GDELT headlines,
    // and `[A2]` is the case that would resolve to the wrong Article if it reached the
    // model — so no interpolated field may carry the citation syntax.
    await createArticle({ storyId: story.id, publisherId: one.id, title: "Pilot line [Video] and [A2] notes" });
    await createArticle({
      storyId: story.id,
      publisherId: two.id,
      title: "Subsidy timing",
      publishedAt: new Date("2026-01-08T00:00:00Z"),
    });
    synth.provider = new MockSynthesisProvider();

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    expect(synth.requests[0].prompt).not.toContain("[Video]");
    expect(res.body.status).toBe("completed");
    expect(res.body.claims[0].citations).toEqual(["A1", "A2"]);
  });

  it("serves a frozen excerpt only where the Publisher's Terms Class clears it", async () => {
    const story = await createStory();
    const licensed = await createPublisher("licensed.example", "licensed");
    const internal = await createPublisher("internal.example", "internal_only");
    await createArticle({ storyId: story.id, publisherId: licensed.id, title: "cleared", mode: "licensed_full_text" });
    await createArticle({
      storyId: story.id,
      publisherId: internal.id,
      title: "held",
      mode: "feed_excerpt",
      publishedAt: new Date("2026-01-07T00:00:00Z"),
    });

    const res = await requestAnalysis(story.id, await tokenFor("student"));

    const byPublisher = new Map<string, string | null>(
      res.body.evidence.map((row: { publisher: { domain: string }; excerpt: string | null }) => [
        row.publisher.domain,
        row.excerpt,
      ]),
    );
    expect(byPublisher.get("licensed.example")).toContain("cleared body text");
    // Frozen and analysed, never redistributed (#40).
    expect(byPublisher.get("internal.example")).toBeNull();
    const frozen: { includedExcerptSnapshot: string }[] = await AppDataSource.query(
      `SELECT esa."includedExcerptSnapshot" FROM "evidence_set_articles" esa
         JOIN "articles" a ON a."id" = esa."articleId" WHERE a."title" = 'held'`,
    );
    expect(frozen[0].includedExcerptSnapshot).toContain("held body text");
  });
});
