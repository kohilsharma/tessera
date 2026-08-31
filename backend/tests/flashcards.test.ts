import "reflect-metadata";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { signToken } from "../src/auth/jwt";
import { EMBEDDING_DIMENSIONS } from "../src/embeddings/EmbeddingProvider";
import { toVectorLiteral } from "../src/embeddings/pgvector";
import { Article } from "../src/entities/Article";
import { Publisher } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { User, type UserRole } from "../src/entities/User";
import { DEFAULT_PROMPT_PARAMS } from "../src/entities/PromptTemplate";
import { PROMPT_VERSION } from "../src/generation/config";
import {
  INITIAL_EASE_FACTOR,
  MIN_EASE_FACTOR,
  dueAfter,
  reschedule,
  type ReviewSchedule,
} from "../src/flashcards/sm2";
import { MockSynthesisProvider } from "../src/synthesis/MockSynthesisProvider";
import type { SynthesisProvider, SynthesisRequest } from "../src/synthesis";
import { setupTestDb } from "./setupTestDb";

// Two seams in one file, because #58 is two things: SM-2, which is arithmetic with a
// right answer, and a deck of cards over an analysis, which is only meaningful end to
// end — a card's answer *is* a validated claim, so the fixture for a card is a real
// generation run, produced through the real endpoint by the Mock provider.
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

let nextRow = 0;

function distinctVector(seed: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = 1;
  // Off-axis, so two Articles on one Story are close reporting rather than the
  // byte-identical wire copy #54 collapses.
  vector[EMBEDDING_DIMENSIONS - 1 - (seed % 512)] = 0.35;
  return vector;
}

async function tokenFor(role: UserRole): Promise<{ token: string; id: string }> {
  nextRow += 1;
  const user = await AppDataSource.getRepository(User).save({
    email: `${role}-${nextRow}@tessera.example`,
    passwordHash: await bcrypt.hash("correct-horse", 10),
    role,
  });
  return { token: signToken({ sub: user.id, role: user.role }), id: user.id };
}

// The Story every test here studies: two Publishers, so evidence selection accepts it
// (ADR-0027's minimum) and an analysis can be written about it.
async function twoPublisherStory(): Promise<Story> {
  nextRow += 1;
  const story = await AppDataSource.getRepository(Story).save({
    slug: `story-${nextRow}`,
    title: "Semiconductor alliance moves to fabrication",
    summary: null,
    category: "technology",
    firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-01-09T00:00:00Z"),
  });
  for (const [index, title] of ["Pilot line targets 2027 output", "Subsidy timing still unresolved"].entries()) {
    nextRow += 1;
    const publisher = await AppDataSource.getRepository(Publisher).save({
      domain: `outlet-${nextRow}.example`,
      name: `Outlet ${nextRow}`,
      termsClass: "licensed",
    });
    const article = await AppDataSource.getRepository(Article).save({
      storyId: story.id,
      storyAssignmentStatus: "auto_accepted",
      storyAssignmentScore: 0.95,
      publisherId: publisher.id,
      title,
      url: `https://outlet-${nextRow}.example/report`,
      analysisText: `${title} body text`,
      analysisTextMode: "manual_fixture",
      publishedAt: new Date(`2026-01-0${2 + index}T00:00:00Z`),
    });
    await AppDataSource.query(`UPDATE "articles" SET "embedding" = $1::vector WHERE "id" = $2`, [
      toVectorLiteral(distinctVector(nextRow)),
      article.id,
    ]);
  }
  return story;
}

// A completed analysis under the caller's own Lens — the only thing a deck can be made
// from, and the fixture for everything below.
async function analysisFor(token: string): Promise<{ storyId: string; runId: string }> {
  const story = await twoPublisherStory();
  const res = await request(app())
    .post(`/api/v1/stories/${story.id}/analysis`)
    .set("Authorization", `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("completed");
  return { storyId: story.id, runId: res.body.id };
}

function makeDeck(token: string, generationRunId: unknown) {
  return request(app())
    .post("/api/v1/flashcards")
    .set("Authorization", `Bearer ${token}`)
    .send({ generationRunId });
}

function studyDeck(token: string) {
  return request(app()).get("/api/v1/flashcards").set("Authorization", `Bearer ${token}`);
}

function reviewCard(token: string, cardId: string, grade: unknown) {
  return request(app())
    .post(`/api/v1/flashcards/${cardId}/reviews`)
    .set("Authorization", `Bearer ${token}`)
    .send({ grade });
}

beforeEach(async () => {
  await AppDataSource.query(
    `TRUNCATE "articles", "publishers", "stories", "users", "evidence_sets", "generation_runs" CASCADE`,
  );
  // Taken by TRUNCATE users CASCADE, and reinstated for the same reason
  // tests/generation.test.ts does: the pipeline reads the current version on every
  // request, so a deck is made over the path a migrated database serves (#57).
  await AppDataSource.query(
    `INSERT INTO "prompt_templates" ("version", "params", "isCurrent") VALUES ($1, $2, true)`,
    [PROMPT_VERSION, JSON.stringify(DEFAULT_PROMPT_PARAMS)],
  );
  synth.requests.length = 0;
  synth.provider = new MockSynthesisProvider();
});

// SM-2 as published (flashcards/sm2.ts). The three state variables are the whole
// algorithm, so these are the checks that fail if the scheduling drifts.
describe("SM-2 scheduling", () => {
  const fresh: ReviewSchedule = { repetitions: 0, easeFactor: INITIAL_EASE_FACTOR, intervalDays: 0 };

  it("schedules the first two passes at the algorithm's fixed intervals", () => {
    const first = reschedule(fresh, 4);
    expect(first).toEqual({ repetitions: 1, easeFactor: INITIAL_EASE_FACTOR, intervalDays: 1 });

    const second = reschedule(first, 4);
    expect(second).toEqual({ repetitions: 2, easeFactor: INITIAL_EASE_FACTOR, intervalDays: 6 });
  });

  it("multiplies by the prior ease factor from the third pass on", () => {
    const third = reschedule({ repetitions: 2, easeFactor: 2.5, intervalDays: 6 }, 5);
    // The 5 raises future ease to 2.6; this interval still uses the 2.5 that the
    // card had when it was reviewed, as canonical SM-2 specifies.
    expect(third).toEqual({ repetitions: 3, easeFactor: 2.6, intervalDays: 15 });
  });

  it("raises ease for a confident recall and lowers it for a struggle", () => {
    expect(reschedule(fresh, 5).easeFactor).toBeCloseTo(2.6, 5);
    expect(reschedule(fresh, 4).easeFactor).toBeCloseTo(2.5, 5);
    expect(reschedule(fresh, 3).easeFactor).toBeCloseTo(2.36, 5);
  });

  it("never lets the ease factor fall below the floor that keeps intervals growing", () => {
    let schedule = fresh;
    for (let pass = 0; pass < 20; pass += 1) schedule = reschedule(schedule, 3);
    expect(schedule.easeFactor).toBe(MIN_EASE_FACTOR);
    // And the interval still grows at the floor, which is what the floor is for.
    expect(reschedule({ repetitions: 4, easeFactor: MIN_EASE_FACTOR, intervalDays: 10 }, 3).intervalDays)
      .toBeGreaterThan(10);
  });

  it("restarts a lapsed card tomorrow and lowers its future ease", () => {
    const learned = { repetitions: 5, easeFactor: 2.3, intervalDays: 40 };
    const lapsed = reschedule(learned, 2);
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.intervalDays).toBe(1);
    expect(lapsed.easeFactor).toBeCloseTo(1.98, 5);
  });

  it("counts the interval from the review rather than from a due date that was missed", () => {
    const reviewedAt = new Date("2026-03-01T09:30:00Z");
    expect(dueAfter(reviewedAt, 6).toISOString()).toBe("2026-03-07T09:30:00.000Z");
  });
});

describe("generating a deck", () => {
  it("makes one card per cited claim, answered by the claim and citing its frozen evidence", async () => {
    const student = await tokenFor("student");
    const { storyId, runId } = await analysisFor(student.token);

    const made = await makeDeck(student.token, runId);

    expect(made.status).toBe(201);
    expect(made.body.storyId).toBe(storyId);
    expect(made.body.cards.length).toBeGreaterThan(0);

    const claims = await AppDataSource.query(
      `SELECT "text" FROM "analysis_claims" WHERE "generationRunId" = $1 ORDER BY "displayOrder"`,
      [runId],
    );
    // Every claim of the analysis, answered verbatim: a card's answer is the claim,
    // not a second telling of it that would need validating again.
    expect(made.body.cards.map((card: { answer: string }) => card.answer)).toEqual(
      claims.map((claim: { text: string }) => claim.text),
    );

    // ADR-0021's guardrail, checked the way it is meant: every citation on every card
    // resolves to a row of the run's own frozen EvidenceSet.
    const frozen: { evidenceId: string; articleId: string }[] = await AppDataSource.query(
      `SELECT esa."evidenceId", esa."articleId" FROM "evidence_set_articles" esa
         JOIN "generation_runs" r ON r."evidenceSetId" = esa."evidenceSetId" WHERE r."id" = $1`,
      [runId],
    );
    for (const card of made.body.cards) {
      expect(card.citations.length).toBeGreaterThan(0);
      expect(card.question).not.toBe("");
      for (const citation of card.citations) {
        expect(frozen).toEqual(
          expect.arrayContaining([{ evidenceId: citation.evidenceId, articleId: citation.articleId }]),
        );
        expect(citation.publisherName).toBeTruthy();
      }
    }
  });

  it("asks the provider for the questions and nothing else", async () => {
    const student = await tokenFor("student");
    const { runId } = await analysisFor(student.token);
    synth.requests.length = 0;

    await makeDeck(student.token, runId);

    expect(synth.requests).toHaveLength(1);
    expect(synth.requests[0].task).toBe("flashcard_questions");
    // The claims go out; the evidence excerpts do not — they were already sent when
    // the analysis was written, and a question does not need them (ADR-0018).
    expect(synth.requests[0].prompt).not.toContain("body text");
  });

  it("falls back to a stated question when the provider does not answer", async () => {
    const student = await tokenFor("student");
    const { runId } = await analysisFor(student.token);
    synth.provider = {
      complete: async () => {
        throw new Error("provider is down");
      },
    };

    const made = await makeDeck(student.token, runId);

    expect(made.status).toBe(201);
    // A duller question in front of a cited answer, not a refused deck.
    expect(made.body.cards[0].question).toBe("What do these outlets agree on?");
    expect(made.body.cards[0].citations.length).toBeGreaterThan(0);
  });

  it("adds nothing and resets nothing when the same analysis is asked for twice", async () => {
    const student = await tokenFor("student");
    const { runId } = await analysisFor(student.token);
    const first = (await makeDeck(student.token, runId)).body.cards;
    // Reviewed between the two requests, so a second deck that replaced the cards
    // would be visible as a schedule back at zero.
    await reviewCard(student.token, first[0].id, 5);

    const again = await makeDeck(student.token, runId);

    expect(again.body.cards.map((card: { id: string }) => card.id)).toEqual(
      first.map((card: { id: string }) => card.id),
    );
    const reviewed = again.body.cards.find((card: { id: string }) => card.id === first[0].id);
    expect(reviewed.repetitions).toBe(1);
    expect(new Date(reviewed.dueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("makes no card for a claim with no citation left behind it", async () => {
    const student = await tokenFor("student");
    const { runId } = await analysisFor(student.token);
    const [claim]: { id: string }[] = await AppDataSource.query(
      `SELECT "id" FROM "analysis_claims" WHERE "generationRunId" = $1 ORDER BY "displayOrder" LIMIT 1`,
      [runId],
    );
    // Nothing in the pipeline can produce this — validation refuses an uncited claim
    // below the prompt — which is exactly why the deck must not be the thing that
    // would emit one if it ever did.
    await AppDataSource.query(`DELETE FROM "claim_evidence" WHERE "claimId" = $1`, [claim.id]);

    const made = await makeDeck(student.token, runId);

    expect(made.body.cards.map((card: { answer: string }) => card.answer)).not.toHaveLength(0);
    const cardedClaims = await AppDataSource.query(`SELECT "claimId" FROM "flashcards"`);
    expect(cardedClaims.map((row: { claimId: string }) => row.claimId)).not.toContain(claim.id);
  });

  it("refuses an analysis that is not a completed one under the caller's own Lens", async () => {
    const student = await tokenFor("student");
    const investor = await tokenFor("investor");

    // Another reader's Lens: the same refusal the generation endpoint makes when a
    // Student asks for the investor Lens outright (ADR-0027).
    const investorAnalysis = await analysisFor(investor.token);
    const wrongLens = await makeDeck(student.token, investorAnalysis.runId);
    expect(wrongLens.status).toBe(422);
    expect(wrongLens.body.error).toMatch(/different Lens/);

    // A failed run has no claims to study.
    const story = await twoPublisherStory();
    synth.provider = { complete: async () => "this is not JSON" };
    const failed = await request(app())
      .post(`/api/v1/stories/${story.id}/analysis`)
      .set("Authorization", `Bearer ${student.token}`)
      .send({});
    expect(failed.body.status).toBe("failed");
    const refused = await makeDeck(student.token, failed.body.id);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatch(/completed analysis/);

    const unknown = await makeDeck(student.token, "00000000-0000-4000-8000-000000000000");
    expect(unknown.status).toBe(422);
    const notAnId = await makeDeck(student.token, "the-latest-one");
    expect(notAnId.status).toBe(422);
  });
});

describe("the study session", () => {
  it("serves the cards that are due, and states both counts", async () => {
    const student = await tokenFor("student");
    const { runId } = await analysisFor(student.token);
    const made = (await makeDeck(student.token, runId)).body.cards;

    const due = await studyDeck(student.token);

    expect(due.status).toBe(200);
    expect(due.body.totalCount).toBe(made.length);
    expect(due.body.dueCount).toBe(made.length);
    expect(due.body.nextDueAt).toBeNull();
    expect(due.body.items[0].citations.length).toBeGreaterThan(0);
  });

  it("reschedules a reviewed card out of the session and says when it returns", async () => {
    const student = await tokenFor("student");
    const { runId } = await analysisFor(student.token);
    const made = (await makeDeck(student.token, runId)).body.cards;

    const reviewed = await reviewCard(student.token, made[0].id, 4);

    expect(reviewed.status).toBe(200);
    expect(reviewed.body.repetitions).toBe(1);
    expect(reviewed.body.intervalDays).toBe(1);
    expect(reviewed.body.lastReviewedAt).not.toBeNull();
    // The answer and its citations come back with the rescheduled card: the surface
    // has just revealed them, and re-fetching to keep them on screen would be a
    // second request for something the review already knew.
    expect(reviewed.body.answer).toBe(made[0].answer);
    expect(reviewed.body.citations).toEqual(made[0].citations);

    const after = await studyDeck(student.token);
    expect(after.body.items.map((card: { id: string }) => card.id)).not.toContain(made[0].id);
    expect(after.body.dueCount).toBe(made.length - 1);
    expect(new Date(after.body.nextDueAt).getTime()).toBeGreaterThan(Date.now());
    expect(after.body.totalCount).toBe(made.length);
  });

  it("shows a lapsed card again rather than pushing it away", async () => {
    const student = await tokenFor("student");
    const { runId } = await analysisFor(student.token);
    const made = (await makeDeck(student.token, runId)).body.cards;

    await reviewCard(student.token, made[0].id, 5);
    const lapsed = await reviewCard(student.token, made[0].id, 1);

    expect(lapsed.body.repetitions).toBe(0);
    expect(lapsed.body.intervalDays).toBe(1);
  });

  it("refuses anything that is not one of SM-2's grades", async () => {
    const student = await tokenFor("student");
    const { runId } = await analysisFor(student.token);
    const made = (await makeDeck(student.token, runId)).body.cards;

    for (const grade of [6, -1, 3.5, "good", null]) {
      const refused = await reviewCard(student.token, made[0].id, grade);
      expect(refused.status).toBe(422);
    }
  });
});

describe("whose cards these are", () => {
  it("keeps one Student's cards out of another's session and out of their reach", async () => {
    const owner = await tokenFor("student");
    const stranger = await tokenFor("student");
    const { runId } = await analysisFor(owner.token);
    const made = (await makeDeck(owner.token, runId)).body.cards;

    const theirs = await studyDeck(stranger.token);
    expect(theirs.body.items).toEqual([]);
    expect(theirs.body.totalCount).toBe(0);

    // Not 403: a card is private study state, so a stranger is not told it exists.
    const reviewed = await reviewCard(stranger.token, made[0].id, 4);
    expect(reviewed.status).toBe(404);

    // And the same analysis makes the stranger their *own* deck, rather than handing
    // them the owner's cards.
    const own = await makeDeck(stranger.token, runId);
    expect(own.status).toBe(201);
    expect(own.body.cards.map((card: { id: string }) => card.id)).not.toContain(made[0].id);
  });

  it("is a Student surface — an Investor and an Admin are refused every route", async () => {
    const student = await tokenFor("student");
    const { runId } = await analysisFor(student.token);
    const made = (await makeDeck(student.token, runId)).body.cards;

    for (const role of ["investor", "admin"] as const) {
      const other = await tokenFor(role);
      expect((await makeDeck(other.token, runId)).status).toBe(403);
      expect((await studyDeck(other.token)).status).toBe(403);
      expect((await reviewCard(other.token, made[0].id, 4)).status).toBe(403);
    }

    expect((await request(app()).get("/api/v1/flashcards")).status).toBe(401);
  });
});
