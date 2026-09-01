import "reflect-metadata";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { signToken } from "../src/auth/jwt";
import { EDGES_PER_ENTITY, ENTITY_PROMOTION_FLOOR, PROMOTABLE_KINDS } from "../src/graph/config";
import { runGraphJob } from "../src/graph/jobs";
import { GRAPH_RUN_JOB, GRAPH_TICK_JOB } from "../src/graph/queue";
import { runEntityResolution } from "../src/graph/runEntityResolution";
import { Article } from "../src/entities/Article";
import { GKG_ANNOTATION_KINDS, type GkgAnnotationKind } from "../src/entities/GkgAnnotation";
import { Publisher } from "../src/entities/Publisher";
import { Story } from "../src/entities/Story";
import { User } from "../src/entities/User";
import { stageAnnotations } from "../src/ingestion/runConnector";
import { setupTestDb } from "./setupTestDb";

// Redis is not in the test stack (#42, #49), so the one enqueue call is recorded here.
// What that leaves untested is bullmq's own guarantee that a job id already in flight
// is not added twice; what it does test is everything either execution path does
// either side of the queue.
const { enqueued } = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock("../src/graph/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/graph/queue")>()),
  enqueueEntityResolutionRun: async () => void enqueued.push("run"),
}));

setupTestDb();

const app = () => createApp();

let nextArticle = 0;

async function createPublisher(domain: string): Promise<Publisher> {
  return AppDataSource.getRepository(Publisher).save({ domain, name: domain });
}

// An Article is only a hook for annotations here, so it carries the firehose rung
// resolution actually reads from — ADR-0028's graph is built over GDELT metadata.
async function createArticle(publisherId: string, title: string): Promise<Article> {
  nextArticle += 1;
  return AppDataSource.getRepository(Article).save({
    publisherId,
    title,
    url: `https://${nextArticle}.example/story`,
    analysisText: null,
    analysisTextMode: "metadata_only",
    publishedAt: new Date("2026-08-31T09:00:00Z"),
  });
}

// Staged through the connector's own function, so the occurrences under test are the
// ones a GKG run would have written. The offset is positional and never asserted on:
// what matters is that two occurrences of one name in one Article are two rows.
let nextOffset = 0;
async function annotate(
  articleId: string,
  named: { kind?: GkgAnnotationKind; name: string; featureId?: string | null }[],
): Promise<void> {
  await stageAnnotations(
    AppDataSource.manager,
    articleId,
    named.map(({ kind = "person", name, featureId }) => {
      nextOffset += 1;
      return {
        kind,
        surfaceName: name,
        charOffset: nextOffset,
        locationDetail:
          kind === "location"
            ? { featureId: featureId ?? null, countryCode: "US", latitude: 1, longitude: 2 }
            : null,
      };
    }),
  );
}

type StoredEntity = { id: string; kind: string; canonicalName: string; normalizedName: string; featureId: string | null };

function entities(): Promise<StoredEntity[]> {
  return AppDataSource.query(
    `SELECT "id", "kind", "canonicalName", "normalizedName", "featureId" FROM "entities"
      ORDER BY "kind", "normalizedName", COALESCE("featureId", '')`,
  ) as Promise<StoredEntity[]>;
}

// Edges by the names on either end, so an assertion reads as the graph rather than as
// a pair of uuids. One row per pair, with its citation count — which is the weight.
// The label is ordered by name because the stored pair is ordered by uuid.
type StoredEdge = { pair: string; citations: number };

function edges(): Promise<StoredEdge[]> {
  return AppDataSource.query(
    `SELECT LEAST(a."canonicalName", b."canonicalName") || ' — ' || GREATEST(a."canonicalName", b."canonicalName")
              AS pair,
            COUNT(*)::int AS citations
       FROM "entity_edges" e
       JOIN "entities" a ON a."id" = e."entityAId"
       JOIN "entities" b ON b."id" = e."entityBId"
      GROUP BY 1 ORDER BY 2 DESC, 1 ASC`,
  ) as Promise<StoredEdge[]>;
}

async function edgeCitations(one: string, other: string): Promise<number> {
  const [row] = (await AppDataSource.query(
    `SELECT COUNT(*)::int AS count
       FROM "entity_edges" e
       JOIN "entities" a ON a."id" = e."entityAId"
       JOIN "entities" b ON b."id" = e."entityBId"
      WHERE (a."canonicalName" = $1 AND b."canonicalName" = $2)
         OR (a."canonicalName" = $2 AND b."canonicalName" = $1)`,
    [one, other],
  )) as { count: number }[];
  return row.count;
}

// AGENTS.md: "every EntityEdge carries its source_article_id — uncited edges are bugs".
// Asserted directly, rather than trusted to the cascade that makes it true, because
// the invariant is the requirement and the cascade is only how it is currently kept.
async function uncitedEdges(): Promise<unknown[]> {
  return AppDataSource.query(
    `SELECT e."id" FROM "entity_edges" e
       LEFT JOIN "articles" a ON a."id" = e."articleId"
      WHERE a."id" IS NULL`,
  ) as Promise<unknown[]>;
}


async function createAdminToken(email: string): Promise<string> {
  const passwordHash = await bcrypt.hash("correct-horse", 10);
  const user = await AppDataSource.getRepository(User).save({ email, passwordHash, role: "admin" });
  return signToken({ sub: user.id, role: user.role });
}

async function registerAndLogin(email: string, role: "student" | "investor"): Promise<string> {
  const res = await request(app()).post("/api/v1/auth/register").send({ email, password: "correct-horse", role });
  return res.body.token as string;
}

// One Article per name pair, `count` times over, which is the cheapest way to put a
// name above or below the floor: the floor counts distinct Articles.
async function coMention(
  publisherId: string,
  names: string[],
  count: number,
  label = names.join("+"),
): Promise<Article[]> {
  const created: Article[] = [];
  for (let index = 0; index < count; index += 1) {
    const article = await createArticle(publisherId, `${label} ${index}`);
    await annotate(
      article.id,
      names.map((name) => ({ name })),
    );
    created.push(article);
  }
  return created;
}

// A hub named alongside `EDGES_PER_ENTITY` others in every one of `count` Articles:
// the hub is then one neighbour short of needing to bound, and each satellite has
// exactly the bound's worth. The fixture the edge bound is argued against.
async function starCluster(publisherId: string, hub: string, prefix: string, count: number): Promise<void> {
  const names = [hub, ...Array.from({ length: EDGES_PER_ENTITY }, (_, index) => `${prefix} ${index}`)];
  for (let index = 0; index < count; index += 1) {
    const article = await createArticle(publisherId, `${prefix} article ${index}`);
    await annotate(
      article.id,
      names.map((name) => ({ name })),
    );
  }
}

beforeEach(async () => {
  await AppDataSource.query(
    `TRUNCATE "articles", "publishers", "stories", "entities", "entity_edges",
              "entity_resolution_runs" CASCADE`,
  );
  enqueued.length = 0;
});

// Every candidate name a pass considered ends either promoted or below the floor, or
// an operator reading a run is reading a number that means nothing. Asserted for every
// run the suite persists, not only the ones a test thought to check.
afterEach(async () => {
  const offenders = await AppDataSource.query(
    `SELECT id, status, considered, promoted, "belowFloor"
       FROM entity_resolution_runs
      WHERE promoted + "belowFloor" <> considered`,
  );
  expect(offenders).toEqual([]);
});

// Seam 1: the pass itself, driven as a function — the shape runConnector and
// runClustering are driven in.
describe("runEntityResolution", () => {
  it("promotes a name that clears the floor, leaves one that does not, and never a Theme", async () => {
    const publisher = await createPublisher("floor.example");
    await coMention(publisher.id, ["Ada Lovelace"], ENTITY_PROMOTION_FLOOR);
    await coMention(publisher.id, ["Passing Mention"], ENTITY_PROMOTION_FLOOR - 1);
    // A Theme in as many Articles as anything else, so only ADR-0028's exclusion can
    // be what keeps it out.
    for (const article of await coMention(publisher.id, ["Grace Hopper"], ENTITY_PROMOTION_FLOOR)) {
      await annotate(article.id, [{ kind: "theme", name: "TAX_FNCACT" }]);
    }

    const run = await runEntityResolution();

    expect(run.status).toBe("succeeded");
    expect((await entities()).map((entity) => entity.canonicalName)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    // The Theme is excluded before the floor, so it is not among what was considered.
    expect(run.considered).toBe(3);
    expect(run.promoted).toBe(2);
    expect(run.belowFloor).toBe(1);
    // The kinds that can promote are a decision, not the absence of one.
    expect(PROMOTABLE_KINDS).not.toContain("theme");
    expect(GKG_ANNOTATION_KINDS).toContain("theme");
  });

  it("folds case, punctuation and whitespace onto one Entity, and displays its commonest form", async () => {
    const publisher = await createPublisher("fold.example");
    // Five Articles spelling one person five ways: no single spelling would clear the
    // floor, and only the fold puts them above it together.
    const spellings = ["Jean-Luc Bernard", "jean luc bernard", "JEAN-LUC BERNARD", "Jean  Luc Bernard", "Jean-Luc Bernard"];
    expect(spellings.length).toBeGreaterThanOrEqual(ENTITY_PROMOTION_FLOOR);
    for (const spelling of spellings) {
      const article = await createArticle(publisher.id, `bernard ${spelling}`);
      await annotate(article.id, [{ name: spelling }]);
    }

    const run = await runEntityResolution();

    const stored = await entities();
    expect(stored).toHaveLength(1);
    expect(stored[0].normalizedName).toBe("jean luc bernard");
    // The commonest surface form, not the fold: a node is labelled with a name GDELT
    // used. `Jean-Luc Bernard` twice beats each of the others once.
    expect(stored[0].canonicalName).toBe("Jean-Luc Bernard");
    expect(run.considered).toBe(1);
    expect(run.promoted).toBe(1);
  });

  it("keeps a location's FeatureID, and treats one name in two places as two Entities", async () => {
    const publisher = await createPublisher("gazetteer.example");
    for (const featureId of ["FEAT-IL", "FEAT-MO"]) {
      for (let index = 0; index < ENTITY_PROMOTION_FLOOR; index += 1) {
        const article = await createArticle(publisher.id, `springfield ${featureId} ${index}`);
        await annotate(article.id, [{ kind: "location", name: "Springfield", featureId }]);
      }
    }
    // The same surface name as a person: kind is part of identity too, so this must
    // not fold into either place.
    await coMention(publisher.id, ["Springfield"], ENTITY_PROMOTION_FLOOR, "person springfield");
    // And a place nobody named often enough, so the floor applies to locations as well.
    for (let index = 0; index < ENTITY_PROMOTION_FLOOR - 1; index += 1) {
      const article = await createArticle(publisher.id, `smallville ${index}`);
      await annotate(article.id, [{ kind: "location", name: "Smallville", featureId: "FEAT-KS" }]);
    }

    const run = await runEntityResolution();

    expect(await entities()).toEqual([
      { id: expect.any(String), kind: "location", canonicalName: "Springfield", normalizedName: "springfield", featureId: "FEAT-IL" },
      { id: expect.any(String), kind: "location", canonicalName: "Springfield", normalizedName: "springfield", featureId: "FEAT-MO" },
      { id: expect.any(String), kind: "person", canonicalName: "Springfield", normalizedName: "springfield", featureId: null },
    ]);
    expect(run.considered).toBe(4);
    expect(run.promoted).toBe(3);
    expect(run.belowFloor).toBe(1);
  });

  it("drops an Entity out of the working set once its Articles have aged out", async () => {
    const publisher = await createPublisher("rolling.example");
    const articles = await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);

    const first = await runEntityResolution();
    expect(first.promoted).toBe(2);
    expect(first.edgesBuilt).toBe(1);
    expect(first.demoted).toBe(0);

    // What the Retention Window does every quarter hour (#45): the Article goes, and
    // its annotations with it, so both names now fall one Article short.
    await AppDataSource.getRepository(Article).delete({ id: articles[0].id });
    const second = await runEntityResolution();

    expect(second.considered).toBe(2);
    expect(second.promoted).toBe(0);
    expect(second.belowFloor).toBe(2);
    expect(second.demoted).toBe(2);
    expect(await entities()).toEqual([]);
    expect(await edges()).toEqual([]);
  });

  it("cites every edge to an Article, and leaves none uncited when Articles are deleted", async () => {
    const publisher = await createPublisher("citations.example");
    const shared = await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR + 2);

    await runEntityResolution();
    expect(await edges()).toEqual([{ pair: "Ada Lovelace — Grace Hopper", citations: ENTITY_PROMOTION_FLOOR + 2 }]);
    expect(await uncitedEdges()).toEqual([]);

    // One citation withdrawn: the edge is weaker, and still an edge.
    await AppDataSource.getRepository(Article).delete({ id: shared[0].id });
    expect(await edgeCitations("Ada Lovelace", "Grace Hopper")).toBe(ENTITY_PROMOTION_FLOOR + 1);
    expect(await uncitedEdges()).toEqual([]);

    // Every citation withdrawn: the edge stops existing, without waiting for a pass.
    // An edge whose Articles are gone would be an edge nobody can show a source for.
    await AppDataSource.getRepository(Article).delete(shared.slice(1).map((article) => article.id));
    expect(await edges()).toEqual([]);
    expect(await uncitedEdges()).toEqual([]);
  });

  it("drops a pair that is outside the strongest EDGES_PER_ENTITY of both its ends", async () => {
    const publisher = await createPublisher("bound.example");
    // Two dense clusters, each hub holding EDGES_PER_ENTITY neighbours at the same
    // weight, and one Article naming both hubs together — a far weaker tie than
    // anything either hub already has.
    await starCluster(publisher.id, "Hub One", "Alpha", ENTITY_PROMOTION_FLOOR);
    await starCluster(publisher.id, "Hub Two", "Beta", ENTITY_PROMOTION_FLOOR);
    const bridge = await createArticle(publisher.id, "bridge");
    await annotate(bridge.id, [{ name: "Hub One" }, { name: "Hub Two" }]);

    const run = await runEntityResolution();

    expect(run.promoted).toBe(2 + 2 * EDGES_PER_ENTITY);
    // The bridge is each hub's weakest of EDGES_PER_ENTITY + 1 neighbours, so it is
    // outside the bound at both ends and is the one pair not kept.
    expect(await edgeCitations("Hub One", "Hub Two")).toBe(0);
    expect(await edgeCitations("Hub One", "Alpha 0")).toBe(ENTITY_PROMOTION_FLOOR);
    // Everything within a cluster survives: a satellite has exactly the bound's worth
    // of neighbours, and a hub's own bound is spent on them.
    const withinCluster = ((EDGES_PER_ENTITY + 1) * EDGES_PER_ENTITY) / 2;
    expect(run.edgesBuilt).toBe(2 * withinCluster);
    expect(await edges()).toHaveLength(2 * withinCluster);
  });

  it("keeps a pair inside only the weaker end's bound, so no Entity loses its own strongest edge", async () => {
    const publisher = await createPublisher("union.example");
    // The hub's EDGES_PER_ENTITY neighbours are all named one Article more often than
    // the outsider, which therefore ranks last from the hub's side.
    await starCluster(publisher.id, "Hub One", "Alpha", ENTITY_PROMOTION_FLOOR + 1);
    const outsider = await coMention(publisher.id, ["Hub One", "Lone Witness"], ENTITY_PROMOTION_FLOOR, "lone");

    await runEntityResolution();

    // Bounding from the hub's side alone would delete the only edge `Lone Witness`
    // has, leaving a promoted Entity with no neighbourhood to read at all.
    expect(await edgeCitations("Hub One", "Lone Witness")).toBe(outsider.length);
    expect(await edgeCitations("Hub One", "Alpha 0")).toBe(ENTITY_PROMOTION_FLOOR + 1);
  });

  it("produces the same Entities and the same edges when re-run over unchanged annotations", async () => {
    const publisher = await createPublisher("idempotent.example");
    await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper", "Katherine Johnson"], ENTITY_PROMOTION_FLOOR);

    const first = await runEntityResolution();
    const before = await entities();
    const edgesBefore = await edges();

    const second = await runEntityResolution();

    // The same ids, not merely the same names: #67's refusals and the read paths above
    // this reference Entities by id, so a pass that renumbered them every hour would
    // break every reference to the graph it just rebuilt.
    expect(await entities()).toEqual(before);
    expect(await edges()).toEqual(edgesBefore);
    expect(second.demoted).toBe(0);
    for (const key of ["considered", "promoted", "belowFloor", "edgesBuilt", "annotationsRead"] as const) {
      expect(second[key]).toBe(first[key]);
    }
  });

  it("persists a failed pass with its reason, leaving the graph the last one built", async () => {
    const publisher = await createPublisher("failure.example");
    await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);
    await runEntityResolution();
    const survived = await entities();

    const failure = new Error("could not serialize access due to concurrent update");
    const spy = vi.spyOn(AppDataSource, "transaction").mockImplementationOnce(() => Promise.reject(failure) as never);
    const run = await runEntityResolution();
    spy.mockRestore();

    expect(run.status).toBe("failed");
    expect(run.errorSummary).toBe(failure.message);
    // The whole pass is one transaction, so a failure is a rollback: a reader sees the
    // graph the last successful pass left, never half of a rebuild.
    expect(await entities()).toEqual(survived);
    expect(await edges()).toEqual([{ pair: "Ada Lovelace — Grace Hopper", citations: ENTITY_PROMOTION_FLOOR }]);
  });

  // The failure above never reaches the counting, so it says nothing about the harder
  // case: a pass that has already counted its candidates and promoted them, and *then*
  // throws. A CHECK the edge insert cannot satisfy fails the pass at its last step, which
  // is where a real one is most likely to fail — it is the only step whose size is the
  // square of the window.
  it("reports nothing promoted on a pass that failed after counting, because nothing was", async () => {
    const publisher = await createPublisher("rollback.example");
    await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);

    await AppDataSource.query(`ALTER TABLE "entity_edges" ADD CONSTRAINT "CHK_test_refuse" CHECK (false)`);
    const run = await runEntityResolution().finally(() =>
      AppDataSource.query(`ALTER TABLE "entity_edges" DROP CONSTRAINT "CHK_test_refuse"`),
    );

    expect(run.status).toBe("failed");
    // What the pass read is true either way, so a failed run still states the size of the
    // input it failed on — that is what makes it diagnosable.
    expect(run.considered).toBe(2);
    expect(run.annotationsRead).toBe(2 * ENTITY_PROMOTION_FLOOR);
    // What it wrote is not: the rollback means no name is an Entity, so the ledger says so
    // rather than reporting two promotions the graph cannot show anyone.
    expect(run.promoted).toBe(0);
    expect(run.belowFloor).toBe(2);
    expect(run.demoted).toBe(0);
    expect(run.edgesBuilt).toBe(0);
    expect(await entities()).toEqual([]);
  });

  // ADR-0029: the Curated Corpus is closed to clustering and *open* to resolution — its
  // Articles are annotated (#62) and the permanent half of a graph whose firehose half
  // rolls over weekly. So a name reported in both corpora is one Entity, and its edges
  // cite Articles from both.
  it("resolves one Entity across the Curated Corpus and the firehose, and cites both", async () => {
    const publisher = await createPublisher("both.example");
    await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR - 1);
    // A fixture Article: our own full text, inside a Story, and excluded from retention
    // three times over — the rung and the membership resolution deliberately ignores.
    const story = await AppDataSource.getRepository(Story).save({
      slug: "curated-graph",
      title: "Curated coverage",
      category: "technology",
      firstSeenAt: new Date("2026-08-31T09:00:00Z"),
      lastSeenAt: new Date("2026-08-31T09:00:00Z"),
    });
    const curated = await AppDataSource.getRepository(Article).save({
      publisherId: publisher.id,
      storyId: story.id,
      storyAssignmentStatus: "auto_accepted" as const,
      title: "Curated reporting naming both",
      url: "https://curated.example/both",
      analysisText: "Ada Lovelace and Grace Hopper.",
      analysisTextMode: "manual_fixture",
      publishedAt: new Date("2026-08-31T09:00:00Z"),
    });
    await annotate(curated.id, [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }]);

    await runEntityResolution();

    // The fixture Article is the fifth citation: without it neither name clears the floor.
    expect((await entities()).map((entity) => entity.canonicalName)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(await edges()).toEqual([{ pair: "Ada Lovelace — Grace Hopper", citations: ENTITY_PROMOTION_FLOOR }]);
    // One pair here, so every edge row is a citation of it — and one of them is the
    // fixture Article, which is the half of the graph that does not roll away.
    const citing = (await AppDataSource.query(`SELECT "articleId" FROM "entity_edges"`)) as { articleId: string }[];
    expect(citing.map((row) => row.articleId)).toContain(curated.id);
  });
});

// Seam 2: the worker's side of the queue. The tick only enqueues, so a scheduled pass
// and an Admin's are the same job.
describe("the graph job", () => {
  it("enqueues a pass on the tick rather than running one", async () => {
    await runGraphJob({ name: GRAPH_TICK_JOB });

    expect(enqueued).toEqual(["run"]);
    expect(await AppDataSource.query(`SELECT "id" FROM "entity_resolution_runs"`)).toEqual([]);
  });

  it("runs a pass on the run job", async () => {
    const publisher = await createPublisher("job.example");
    await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);

    await runGraphJob({ name: GRAPH_RUN_JOB });

    const runs = (await AppDataSource.query(
      `SELECT "status", "promoted", "edgesBuilt" FROM "entity_resolution_runs"`,
    )) as { status: string; promoted: number; edgesBuilt: number }[];
    expect(runs).toEqual([{ status: "succeeded", promoted: 2, edgesBuilt: 1 }]);
    expect(enqueued).toEqual([]);
  });

  it("refuses a job name it does not know", async () => {
    await expect(runGraphJob({ name: "resolve-everything" })).rejects.toThrow('Unknown graph job "resolve-everything"');
  });
});

// Seam 3: the Admin trigger, which enqueues onto the same queue the tick feeds, so
// there is one execution path.
describe("POST /api/v1/graph/resolution-runs", () => {
  it("accepts an Admin trigger and enqueues rather than running in the request", async () => {
    const token = await createAdminToken("resolution-admin@example.com");
    const publisher = await createPublisher("trigger.example");
    await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);

    const res = await request(app())
      .post("/api/v1/graph/resolution-runs")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "accepted" });
    expect(enqueued).toEqual(["run"]);
    // The request itself resolved nothing: the worker is what executes the pass.
    expect(await entities()).toEqual([]);
  });

  it("refuses a Student, an Investor and an anonymous caller", async () => {
    for (const role of ["student", "investor"] as const) {
      const token = await registerAndLogin(`${role}-resolution@example.com`, role);
      const res = await request(app())
        .post("/api/v1/graph/resolution-runs")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    }
    expect((await request(app()).post("/api/v1/graph/resolution-runs").send({})).status).toBe(401);
    expect(enqueued).toEqual([]);
  });
});

// Seam 4: the read path the Admin console renders. Postgres, never the queue — which
// is why this passes with no Redis in the test stack at all.
describe("GET /api/v1/dashboard/admin", () => {
  it("carries resolution history with the worker stopped", async () => {
    const publisher = await createPublisher("history.example");
    await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);
    await runEntityResolution();
    const token = await createAdminToken("history-admin@example.com");

    const res = await request(app()).get("/api/v1/dashboard/admin").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.entityResolutionRuns).toHaveLength(1);
    expect(res.body.entityResolutionRuns[0]).toMatchObject({
      status: "succeeded",
      considered: 2,
      promoted: 2,
      belowFloor: 0,
      demoted: 0,
      edgesBuilt: 1,
      errorSummary: null,
    });
    expect(res.body.entityResolutionRuns[0].completedAt).not.toBeNull();
  });
});
