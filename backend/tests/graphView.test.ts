import "reflect-metadata";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { ENTITY_PROMOTION_FLOOR, VIEW_EDGES_PER_ENTITY, VIEW_NODE_CAP } from "../src/graph/config";
import { runEntityResolution } from "../src/graph/runEntityResolution";
import { GDELT_RETENTION_DAYS } from "../src/ingestion/retention";
import {
  adminToken,
  annotate,
  coMention,
  createArticle,
  createPublisher,
  crowdNames,
  reader,
  truncateGraph,
} from "./graphFixture";
import { setupTestDb } from "./setupTestDb";

// #68: the one bounded global view every reader shares. The pass (#66) is the fixture
// generator throughout — a graph assembled by hand would let this file agree with
// itself about a shape the pass never produces. The generator is shared with #69's
// neighbourhood (./graphFixture), because the two surfaces read one graph.
setupTestDb();

const app = () => createApp();

type GraphBody = {
  retainedDays: number;
  promotionFloor: number;
  entityCount: number;
  articleCount: number;
  from: string | null;
  to: string | null;
  nodes: { id: string; kind: string; canonicalName: string; articleCount: number }[];
  edges: { entityAId: string; entityBId: string; weight: number }[];
};

async function graph(token: string, query = ""): Promise<GraphBody> {
  const res = await request(app()).get(`/api/v1/graph${query}`).set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as GraphBody;
}

// An edge read as the two names on its ends, so an assertion reads as the graph rather
// than as a pair of uuids.
function labelled(body: GraphBody): { pair: string; weight: number }[] {
  const name = new Map(body.nodes.map((node) => [node.id, node.canonicalName]));
  return body.edges.map(({ entityAId, entityBId, weight }) => ({
    pair: [name.get(entityAId) ?? entityAId, name.get(entityBId) ?? entityBId].sort().join(" — "),
    weight,
  }));
}

beforeEach(truncateGraph);

describe("the bounded global graph", () => {
  it("is closed to an anonymous caller", async () => {
    const res = await request(app()).get("/api/v1/graph");
    expect(res.status).toBe(401);
  });

  it("draws the Entities the pass promoted, each with the reporting behind it", async () => {
    const publisher = await createPublisher("wire.example");
    await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR + 2);
    await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);
    await runEntityResolution();

    const body = await graph(await reader("student"));

    // Ada first: she is in both runs of reporting, which is what "most present" means.
    expect(body.nodes.map((node) => [node.canonicalName, node.articleCount])).toEqual([
      ["Ada Lovelace", 2 * ENTITY_PROMOTION_FLOOR + 2],
      ["Charles Babbage", ENTITY_PROMOTION_FLOOR + 2],
      ["Grace Hopper", ENTITY_PROMOTION_FLOOR],
    ]);
    expect(body.nodes.map((node) => node.kind)).toEqual(["person", "person", "person"]);
  });

  it("weights an edge by the Articles that co-mention the pair, and draws no edge to a node it did not draw", async () => {
    const publisher = await createPublisher("wire.example");
    await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR + 2);
    await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);
    // Below the floor, so no Entity and therefore no edge — the graph is not a reading
    // of every name GDELT reported.
    await coMention(publisher.id, ["Ada Lovelace", "Passing Mention"], ENTITY_PROMOTION_FLOOR - 1);
    await runEntityResolution();

    const body = await graph(await reader("investor"));

    expect(labelled(body)).toEqual([
      { pair: "Ada Lovelace — Charles Babbage", weight: ENTITY_PROMOTION_FLOOR + 2 },
      { pair: "Ada Lovelace — Grace Hopper", weight: ENTITY_PROMOTION_FLOOR },
    ]);
    const drawn = new Set(body.nodes.map((node) => node.id));
    expect(body.edges.every((edge) => drawn.has(edge.entityAId) && drawn.has(edge.entityBId))).toBe(true);
  });

  it("bounds the picture to the view's node count, and states the working set it was drawn from", async () => {
    const publisher = await createPublisher("wire.example");
    const names = crowdNames(VIEW_NODE_CAP + 2);
    await coMention(publisher.id, names, ENTITY_PROMOTION_FLOOR, "crowd");
    await runEntityResolution();

    const body = await graph(await adminToken());

    expect(body.nodes).toHaveLength(VIEW_NODE_CAP);
    expect(body.entityCount).toBe(names.length);
    // Which of a tied crowd is drawn is the ordering's business; that every drawn name
    // is one the pass promoted is the view's.
    expect(body.nodes.every((node) => names.includes(node.canonicalName))).toBe(true);
    // Each drawn node contributes at most its own strongest few, so this is the ceiling
    // the bound puts on the picture — not a count the fixture happens to produce.
    expect(body.edges.length).toBeLessThanOrEqual(VIEW_NODE_CAP * VIEW_EDGES_PER_ENTITY);
    const drawn = new Set(body.nodes.map((node) => node.id));
    expect(body.edges.every((edge) => drawn.has(edge.entityAId) && drawn.has(edge.entityBId))).toBe(true);
  });

  it("ignores every parameter a caller could widen a bound with", async () => {
    const publisher = await createPublisher("wire.example");
    await coMention(publisher.id, crowdNames(VIEW_NODE_CAP + 2), ENTITY_PROMOTION_FLOOR, "crowd");
    await runEntityResolution();
    const token = await reader("student");

    const bounded = await graph(token);
    const asked = await graph(token, "?nodes=5000&limit=5000&pageSize=5000&edgesPerEntity=500&depth=9");

    expect(asked).toEqual(bounded);
    expect(asked.nodes).toHaveLength(VIEW_NODE_CAP);
  });

  it("keeps a node's own strongest co-mention even where the other end has stronger ones", async () => {
    const publisher = await createPublisher("wire.example");
    // A hub named alongside more satellites than the view's per-node bound. Each
    // satellite's one and only tie is the hub, so the bound applied from both ends
    // must keep every one of them: a node whose whole neighbourhood is missing has
    // been drawn as an isolated dot about nothing.
    const satellites = Array.from({ length: VIEW_EDGES_PER_ENTITY + 3 }, (_, index) => `Satellite ${index}`);
    for (const [index, satellite] of satellites.entries()) {
      await coMention(publisher.id, ["Wire Service", satellite], ENTITY_PROMOTION_FLOOR + index, satellite);
    }
    await runEntityResolution();

    const body = await graph(await reader("student"));

    const reach = new Set(body.edges.flatMap((edge) => [edge.entityAId, edge.entityBId]));
    expect(body.nodes.filter((node) => !reach.has(node.id))).toEqual([]);
    expect(body.edges).toHaveLength(satellites.length);
  });

  it("states the corpus window over the reporting its edges cite, and nothing else", async () => {
    const publisher = await createPublisher("wire.example");
    const cited = await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR);
    // Later reporting that names one Entity and no second one: it cites no edge, so it
    // is not what the graph rests on and must not stretch the window it states.
    const alone = await createArticle(publisher.id, "one name only");
    await annotate(alone.id, ["Ada Lovelace"]);
    await runEntityResolution();

    const body = await graph(await reader("student"));

    expect(body.articleCount).toBe(cited.length);
    expect(body.from).toBe(cited[0].publishedAt.toISOString());
    expect(body.to).toBe(cited[cited.length - 1].publishedAt.toISOString());
    expect(new Date(body.to!).getTime()).toBeLessThan(alone.publishedAt.getTime());
    // Both bounds the reader is owed an explanation from, read from the modules that
    // own them rather than restated here.
    expect(body.retainedDays).toBe(GDELT_RETENTION_DAYS);
    expect(body.promotionFloor).toBe(ENTITY_PROMOTION_FLOOR);
  });

  it("reads one graph for a Student and an Investor, with no role-specific weighting", async () => {
    const publisher = await createPublisher("wire.example");
    await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR);
    await runEntityResolution();

    const student = await graph(await reader("student"));
    const investor = await graph(await reader("investor"));

    expect(student).toEqual(investor);
  });

  it("answers a graph with nothing in it rather than an error when no name has been resolved", async () => {
    const body = await graph(await reader("student"));

    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(body.entityCount).toBe(0);
    expect(body.articleCount).toBe(0);
    expect(body.from).toBeNull();
    expect(body.to).toBeNull();
    expect(body.promotionFloor).toBe(ENTITY_PROMOTION_FLOOR);
  });

  // The second empty graph, and the reason `entityCount` is returned rather than derived
  // from `nodes`: a name can clear the promotion floor and still be co-cited by nothing, in
  // which case the view draws no isolate and there is a working set the picture cannot show.
  // A reader told "no name has been resolved" here would be told the opposite of the truth,
  // so the page needs the two states apart and this is the one that makes them different.
  it("counts a promoted name nothing co-cites, and draws nothing", async () => {
    const publisher = await createPublisher("wire.example");
    // Every Article names one name only, so the floor is cleared and no pair exists.
    for (let index = 0; index < ENTITY_PROMOTION_FLOOR; index += 1) {
      const article = await createArticle(publisher.id, `alone ${index}`);
      await annotate(article.id, ["Ada Lovelace"]);
    }
    await runEntityResolution();

    const body = await graph(await reader("student"));

    expect(body.entityCount).toBe(1);
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(body.articleCount).toBe(0);
    expect(body.from).toBeNull();
  });
});
