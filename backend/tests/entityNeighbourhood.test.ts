import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import {
  EDGES_PER_ENTITY,
  EDGE_CITATION_CAP,
  ENTITY_PROMOTION_FLOOR,
  VIEW_EDGES_PER_ENTITY,
  VIEW_NODE_CAP,
} from "../src/graph/config";
import { runEntityResolution } from "../src/graph/runEntityResolution";
import { Article } from "../src/entities/Article";
import { Entity } from "../src/entities/Entity";
import { Story } from "../src/entities/Story";
import { GDELT_RETENTION_DAYS } from "../src/ingestion/retention";
import {
  annotate,
  coMention,
  createArticle,
  createPublisher,
  crowdNames,
  reader,
  truncateGraph,
} from "./graphFixture";
import { setupTestDb } from "./setupTestDb";

// #69: one Entity's neighbourhood, and the evidence under every edge of it. The bounds
// and the promotion floor are the global view's own (../src/graph/loadGraphView.ts), so
// what this file mostly holds to account is the part that is *not* shared: which names
// one hop reaches, that a focus never loses a tie to the bound that keeps the rest
// legible, that a Theme narrows the picture without ever becoming part of it, and that
// an edge opens the reporting it was observed in and nothing else.
setupTestDb();

const app = () => createApp();

type NeighbourhoodBody = {
  retainedDays: number;
  promotionFloor: number;
  depth: number;
  focus: {
    id: string;
    kind: string;
    canonicalName: string;
    aliases: string[];
    articleCount: number;
    from: string | null;
    to: string | null;
  };
  theme: string | null;
  themes: { theme: string; articleCount: number }[];
  neighbourCount: number;
  nodes: { id: string; kind: string; canonicalName: string; articleCount: number }[];
  edges: { entityAId: string; entityBId: string; weight: number }[];
};

type CitationsBody = {
  weight: number;
  citations: {
    id: string;
    title: string;
    url: string;
    publishedAt: string;
    analysisTextMode: string;
    publisher: { id: string; name: string; domain: string };
    story: { id: string; slug: string; title: string } | null;
  }[];
};

// The pass decides which ids exist, so a test names an Entity the way a reader does —
// by the name it was reported under — and reads the id back out.
async function entityId(canonicalName: string): Promise<string> {
  const entity = await AppDataSource.getRepository(Entity).findOneByOrFail({ canonicalName });
  return entity.id;
}

async function neighbourhood(token: string, id: string, query = ""): Promise<NeighbourhoodBody> {
  const res = await request(app())
    .get(`/api/v1/graph/entities/${id}${query}`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as NeighbourhoodBody;
}

function edgeUrl(a: string, b: string, query = ""): string {
  return `/api/v1/graph/entities/${a}/edges/${b}${query}`;
}

async function citations(token: string, a: string, b: string, query = ""): Promise<CitationsBody> {
  const res = await request(app()).get(edgeUrl(a, b, query)).set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body as CitationsBody;
}

const drawn = (body: NeighbourhoodBody) => body.nodes.map((node) => node.canonicalName);

// An edge read as the two names on its ends, so an assertion reads as the graph rather
// than as a pair of uuids — and so it does not depend on which of the two names sorted
// into `entityAId`, which is the storage's business and not the picture's.
function labelled(body: NeighbourhoodBody): { pair: string; weight: number }[] {
  const name = new Map(body.nodes.map((node) => [node.id, node.canonicalName]));
  return body.edges.map(({ entityAId, entityBId, weight }) => ({
    pair: [name.get(entityAId) ?? entityAId, name.get(entityBId) ?? entityBId].sort().join(" — "),
    weight,
  }));
}

// Which of the drawn edges touch the name the page is about — the ties one hop out, as
// against the interlinks drawn between the neighbours themselves.
const focusTies = (body: NeighbourhoodBody) =>
  body.edges.filter((edge) => edge.entityAId === body.focus.id || edge.entityBId === body.focus.id);

beforeEach(truncateGraph);

describe("one Entity's neighbourhood", () => {
  it("is closed to an anonymous caller", async () => {
    const res = await request(app()).get(`/api/v1/graph/entities/${randomUUID()}`);
    expect(res.status).toBe(401);
  });

  // A name that has been demoted or merged away is a name the graph no longer has, and
  // an id that was never one is the same fact arriving differently. Both are 404 rather
  // than an empty neighbourhood, which would state that a name exists with nothing
  // around it.
  it("answers 404 for a name the graph does not have, and for an id that is not one", async () => {
    const token = await reader("student");

    for (const id of [randomUUID(), "not-a-uuid"]) {
      const res = await request(app())
        .get(`/api/v1/graph/entities/${id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404);
    }
  });

  it("draws the focus, the names one hop from it, and the reporting behind each", async () => {
    const publisher = await createPublisher("wire.example");
    const strong = await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR + 2);
    const weak = await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);
    await runEntityResolution();

    const body = await neighbourhood(await reader("student"), await entityId("Ada Lovelace"));

    // The focus first, then its ties strongest first: this is a picture of one name's
    // surroundings, so what it is nearest is the ordering a reader came for.
    expect(drawn(body)).toEqual(["Ada Lovelace", "Charles Babbage", "Grace Hopper"]);
    expect(body.focus).toMatchObject({
      kind: "person",
      canonicalName: "Ada Lovelace",
      // Ada is in both runs of reporting; the count is her whole presence in the graph,
      // the same quantity the global view sizes her node by.
      articleCount: 2 * ENTITY_PROMOTION_FLOOR + 2,
      // Nothing has been folded into this name, and an empty list says so rather than
      // leaving a reader to wonder whether aliases were looked for.
      aliases: [],
      from: strong[0].publishedAt.toISOString(),
      to: weak[weak.length - 1].publishedAt.toISOString(),
    });
    expect(labelled(body)).toEqual([
      { pair: "Ada Lovelace — Charles Babbage", weight: ENTITY_PROMOTION_FLOOR + 2 },
      { pair: "Ada Lovelace — Grace Hopper", weight: ENTITY_PROMOTION_FLOOR },
    ]);
    expect(body.neighbourCount).toBe(2);
    // One hop, stated rather than implied: the page has to say how far out it is
    // reading, and the number is the view's, not a caller's.
    expect(body.depth).toBe(1);
    // Both bounds the reader is owed an explanation from, read from the modules that
    // own them rather than restated here.
    expect(body.retainedDays).toBe(GDELT_RETENTION_DAYS);
    expect(body.promotionFloor).toBe(ENTITY_PROMOTION_FLOOR);
  });

  // The picture is bounded by the global view's own constants, applied to a different
  // selection. How many names are one hop out is decided first by the pass — it keeps
  // each Entity's strongest `EDGES_PER_ENTITY` ties, from both ends, so a crowd of any
  // size arrives here already bounded — and then by the view's cap on top of that. The
  // relation between the two is what is asserted; the count itself belongs to whichever
  // ids the pass happened to keep.
  it("bounds one hop by the same rules the global view is bounded by", async () => {
    const publisher = await createPublisher("wire.example");
    const names = crowdNames(VIEW_NODE_CAP + 2);
    await coMention(publisher.id, names, ENTITY_PROMOTION_FLOOR, "crowd");
    await runEntityResolution();

    const body = await neighbourhood(await reader("investor"), await entityId(names[0]));

    expect(body.neighbourCount).toBeGreaterThanOrEqual(EDGES_PER_ENTITY);
    expect(body.nodes).toHaveLength(Math.min(body.neighbourCount + 1, VIEW_NODE_CAP));
    expect(body.nodes.every((node) => names.includes(node.canonicalName))).toBe(true);
    // The view's edge bound is what the *interlinks* are held to — each neighbour keeps its
    // strongest `VIEW_EDGES_PER_ENTITY`, from both ends. The focus's own ties are exempt from
    // it on purpose (the test below), so they are counted apart rather than folded into a
    // bound they were never under: every name drawn is drawn because it ties to the focus.
    const ties = focusTies(body);
    expect(ties).toHaveLength(body.nodes.length - 1);
    expect(body.edges.length - ties.length).toBeLessThanOrEqual(
      (body.nodes.length - 1) * VIEW_EDGES_PER_ENTITY,
    );
    const ids = new Set(body.nodes.map((node) => node.id));
    expect(body.edges.every((edge) => ids.has(edge.entityAId) && ids.has(edge.entityBId))).toBe(true);
  });

  // The one bound a neighbourhood needs that the global view does not. Every neighbour
  // is here *because* it ties to the focus, so a neighbour drawn without that tie is a
  // dot placed for a reason the picture no longer shows. The edge bound is applied from
  // both ends, and both ends can exceed it: each satellite has six stronger ties to its
  // siblings, and the focus has more ties than the bound allows either.
  it("keeps every tie to the focus, even where both ends have stronger ones", async () => {
    const publisher = await createPublisher("wire.example");
    const orbit = crowdNames(VIEW_EDGES_PER_ENTITY + 2, "Orbit");
    for (const satellite of orbit) {
      await coMention(publisher.id, ["Wire Service", satellite], ENTITY_PROMOTION_FLOOR, satellite);
    }
    // Every satellite reported with every other, harder than any of them was reported
    // with the focus.
    await coMention(publisher.id, orbit, ENTITY_PROMOTION_FLOOR + 5, "orbit");
    await runEntityResolution();

    const body = await neighbourhood(await reader("student"), await entityId("Wire Service"));

    expect(body.neighbourCount).toBe(orbit.length);
    expect(focusTies(body)).toHaveLength(orbit.length);
    // The bound is still applied to the interlinks between the neighbours, which is what
    // keeps the picture legible once the focus's own ties are safe.
    expect(body.edges.length).toBeGreaterThan(orbit.length);
    expect(body.edges.length).toBeLessThanOrEqual(body.nodes.length * VIEW_EDGES_PER_ENTITY);
  });

  // ADR-0028's rule, made visible: a Theme is what the picture is narrowed *by*, never
  // something drawn in it. 2,072 controlled-vocabulary values at ~48 per Article make
  // theme-to-theme co-occurrence a complete graph that says nothing — but that same
  // vocabulary is exactly what a crowded neighbourhood needs to be read one subject at a
  // time.
  it("narrows the neighbourhood to a Theme, and never draws the Theme", async () => {
    const publisher = await createPublisher("wire.example");
    const market = await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR);
    const disaster = await coMention(publisher.id, ["Ada Lovelace", "Grace Hopper"], ENTITY_PROMOTION_FLOOR);
    for (const article of market) await annotate(article.id, ["ECON_STOCKMARKET"], "theme");
    for (const article of disaster) await annotate(article.id, ["MANMADE_DISASTER"], "theme");
    await runEntityResolution();

    const body = await neighbourhood(
      await reader("student"),
      await entityId("Ada Lovelace"),
      "?theme=ECON_STOCKMARKET",
    );

    expect(body.theme).toBe("ECON_STOCKMARKET");
    expect(drawn(body)).toEqual(["Ada Lovelace", "Charles Babbage"]);
    expect(labelled(body)).toEqual([
      { pair: "Ada Lovelace — Charles Babbage", weight: ENTITY_PROMOTION_FLOOR },
    ]);
    // The Theme is not a node here, and it is not an Entity anywhere: the pass never
    // promoted it, so the facet cannot become part of the thing it narrows.
    await expect(
      AppDataSource.getRepository(Entity).findOneBy({ canonicalName: "ECON_STOCKMARKET" }),
    ).resolves.toBeNull();
    // The vocabulary offered is computed over the focus's *whole* reporting rather than
    // the facet's, so a reader who narrows to one Theme can still see — and reach — the
    // others. A facet list filtered by the facet in force would dead-end on the first click.
    expect(body.themes).toEqual([
      { theme: "ECON_STOCKMARKET", articleCount: ENTITY_PROMOTION_FLOOR },
      { theme: "MANMADE_DISASTER", articleCount: ENTITY_PROMOTION_FLOOR },
    ]);
  });

  // The facet is applied to the citations the picture rests on, not to the picture after
  // it is drawn. So a pair reported under two Themes weighs less under one of them, and
  // the profile's count and window move with it: every number on the page has to be about
  // the reporting the page is actually showing, or the weight states one corpus and the
  // list beneath it opens another.
  it("reweights an edge and restates the focus's window by the facet's own citations", async () => {
    const publisher = await createPublisher("wire.example");
    const pair = ["Ada Lovelace", "Charles Babbage"];
    const under = await coMention(publisher.id, pair, ENTITY_PROMOTION_FLOOR, "under");
    const outside = await coMention(publisher.id, pair, 3, "outside");
    for (const article of under) await annotate(article.id, ["ECON_STOCKMARKET"], "theme");
    for (const article of outside) await annotate(article.id, ["MANMADE_DISASTER"], "theme");
    await runEntityResolution();

    const token = await reader("student");
    const ada = await entityId("Ada Lovelace");
    const whole = await neighbourhood(token, ada);
    const faceted = await neighbourhood(token, ada, "?theme=ECON_STOCKMARKET");

    expect(whole.theme).toBeNull();
    expect(labelled(whole)).toEqual([
      { pair: "Ada Lovelace — Charles Babbage", weight: ENTITY_PROMOTION_FLOOR + 3 },
    ]);
    expect(labelled(faceted)).toEqual([
      { pair: "Ada Lovelace — Charles Babbage", weight: ENTITY_PROMOTION_FLOOR },
    ]);
    expect(faceted.focus.articleCount).toBe(ENTITY_PROMOTION_FLOOR);
    expect(faceted.focus.from).toBe(under[0].publishedAt.toISOString());
    expect(faceted.focus.to).toBe(under[under.length - 1].publishedAt.toISOString());
    expect(whole.focus.to).toBe(outside[outside.length - 1].publishedAt.toISOString());
  });

  // A stale link, a Theme this name was never reported under, or a facet whose reporting
  // has aged out of the retained window: all three are a page with nothing on it rather
  // than an error. The focus is still the focus and the vocabulary is still offered, so
  // the reader's way back is on the page they landed on.
  it("answers an empty neighbourhood for a Theme the focus was never reported under", async () => {
    const publisher = await createPublisher("wire.example");
    const reported = await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR);
    for (const article of reported) await annotate(article.id, ["ECON_STOCKMARKET"], "theme");
    await runEntityResolution();

    const body = await neighbourhood(await reader("investor"), await entityId("Ada Lovelace"), "?theme=WATER_SECURITY");

    expect(body.theme).toBe("WATER_SECURITY");
    expect(drawn(body)).toEqual(["Ada Lovelace"]);
    expect(body.edges).toEqual([]);
    expect(body.neighbourCount).toBe(0);
    expect(body.focus.articleCount).toBe(0);
    expect(body.focus.from).toBeNull();
    expect(body.themes.map((facet) => facet.theme)).toEqual(["ECON_STOCKMARKET"]);
  });

  // The Theme is the one parameter this page accepts, because it only ever narrows. Every
  // parameter that would widen a bound is ignored rather than rejected: a bound is not a
  // parameter, so `?depth=9` is not a malformed request, it is a request about nothing.
  it("ignores every parameter a caller could widen a bound with", async () => {
    const publisher = await createPublisher("wire.example");
    await coMention(publisher.id, crowdNames(VIEW_NODE_CAP + 2), ENTITY_PROMOTION_FLOOR, "crowd");
    await runEntityResolution();
    const token = await reader("student");
    const focus = await entityId("Crowd 00");

    const bounded = await neighbourhood(token, focus);
    const asked = await neighbourhood(token, focus, "?nodes=5000&limit=5000&edgesPerEntity=500&depth=9");

    expect(asked).toEqual(bounded);
    expect(asked.depth).toBe(1);
  });

  it("reads one neighbourhood for a Student and an Investor, with no role-specific weighting", async () => {
    const publisher = await createPublisher("wire.example");
    await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR);
    await runEntityResolution();
    const ada = await entityId("Ada Lovelace");

    const student = await neighbourhood(await reader("student"), ada);
    const investor = await neighbourhood(await reader("investor"), ada);

    expect(student).toEqual(investor);
  });

  // The fourth UI state, and the one retention produces on its own: every co-mention this
  // name had has rolled out of the retained window, leaving a name the graph still holds —
  // it cleared the floor — with nothing around it. Not a 404, because the name exists; not
  // a lone dot either, because the page states it in words. The focus is always in `nodes`,
  // so a caller never has to reconstruct the middle of the picture from the profile.
  it("answers the focus alone for a name nothing co-cites", async () => {
    const publisher = await createPublisher("wire.example");
    for (let index = 0; index < ENTITY_PROMOTION_FLOOR; index += 1) {
      const article = await createArticle(publisher.id, `alone ${index}`);
      await annotate(article.id, ["Ada Lovelace"]);
    }
    await runEntityResolution();

    const body = await neighbourhood(await reader("student"), await entityId("Ada Lovelace"));

    expect(drawn(body)).toEqual(["Ada Lovelace"]);
    expect(body.edges).toEqual([]);
    expect(body.neighbourCount).toBe(0);
    expect(body.focus.articleCount).toBe(0);
    expect(body.focus.from).toBeNull();
    expect(body.focus.to).toBeNull();
    expect(body.themes).toEqual([]);
  });

  // A profile states what was folded into the name it is about, because the fold is the
  // part a reader cannot check: the reporting under a merged spelling is counted here, and
  // a page that showed the total without saying so would be presenting two names' evidence
  // as one name's. #67's measurement is the fixture — one mistyped character at 0.923, over
  // the automatic bar — so what is asserted is the pass's own merge and not a hand-written
  // alias row.
  //
  // The alias reads as the normalized form because that is the whole of what the fold
  // stores: `entity_aliases` is keyed by normalized name and keeps no surface spelling.
  // ponytail: carry the surface form when a page needs `Massachusets` back in its own case.
  it("states the names folded into the focus", async () => {
    const publisher = await createPublisher("wire.example");
    const spelled = "Massachusetts Institute of Technology";
    const mistyped = "Massachusets Institute of Technology";
    await coMention(publisher.id, [spelled, "Ada Lovelace"], ENTITY_PROMOTION_FLOOR + 1, "spelled");
    await coMention(publisher.id, [mistyped, "Ada Lovelace"], ENTITY_PROMOTION_FLOOR, "mistyped");
    await runEntityResolution();

    const body = await neighbourhood(await reader("student"), await entityId(spelled));

    expect(body.focus.canonicalName).toBe(spelled);
    expect(body.focus.aliases).toEqual(["massachusets institute of technology"]);
    // The merged name is gone from the graph, and its reporting arrived here: both runs
    // co-mention Ada, so the surviving edge carries every Article either spelling was in.
    expect(labelled(body)).toEqual([
      { pair: `Ada Lovelace — ${spelled}`, weight: 2 * ENTITY_PROMOTION_FLOOR + 1 },
    ]);
  });
});

// The citation invariant made openable: every EntityEdge carries the Article it was
// observed in, so a reader can read the reporting under a line rather than trust it.
describe("the evidence under one edge", () => {
  it("is closed to an anonymous caller", async () => {
    const res = await request(app()).get(edgeUrl(randomUUID(), randomUUID()));
    expect(res.status).toBe(401);
  });

  it("opens the reporting an edge was observed in, most recent first and either way round", async () => {
    const publisher = await createPublisher("wire.example");
    const cited = await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR);
    // Reporting that names one end and not the other. It is why this name is in the graph
    // at all, and it is not evidence for this pair, so it must not open under it.
    const alone = await createArticle(publisher.id, "one name only");
    await annotate(alone.id, ["Ada Lovelace"]);
    await runEntityResolution();

    const token = await reader("student");
    const ada = await entityId("Ada Lovelace");
    const babbage = await entityId("Charles Babbage");
    const body = await citations(token, ada, babbage);

    expect(body.weight).toBe(ENTITY_PROMOTION_FLOOR);
    // Newest first: the same order every other reader surface lists reporting in, and the
    // order that makes a bounded list the current evidence rather than the oldest.
    expect(body.citations.map((citation) => citation.title)).toEqual(
      [...cited].reverse().map((article) => article.title),
    );
    expect(body.citations.map((citation) => citation.url)).not.toContain(alone.url);
    expect(body.citations[0].publisher).toMatchObject({ name: "wire.example", domain: "wire.example" });
    // A pair is stored ordered by id (`CHK_entity_edges_ordered`), which is storage's
    // business: a reader arrives from whichever end of the line they clicked.
    expect(await citations(token, babbage, ada)).toEqual(body);
  });

  // Each citation links to the Article record, and to the Story where there is one to
  // reach. `src/lib/storyMembership.ts` is the one membership predicate every reader
  // surface tests, and this join uses it rather than a second reading of the same column:
  // an Article the clustering pass is still unsure about is reporting a reader can open,
  // and not yet a Story a reader can be sent to.
  it("names the Story an Article was accepted into, and nothing for one still under review", async () => {
    const publisher = await createPublisher("wire.example");
    const story = await AppDataSource.getRepository(Story).save({
      slug: "ada-and-babbage",
      title: "Ada and Babbage",
      category: "technology",
      firstSeenAt: new Date("2026-08-25T00:00:00Z"),
      lastSeenAt: new Date("2026-08-25T00:00:00Z"),
    });
    const cited = await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR);
    const articles = AppDataSource.getRepository(Article);
    await articles.update(cited[0].id, { storyId: story.id, storyAssignmentStatus: "auto_accepted" });
    await articles.update(cited[1].id, { storyId: story.id, storyAssignmentStatus: "pending_review" });
    await runEntityResolution();

    const body = await citations(
      await reader("investor"),
      await entityId("Ada Lovelace"),
      await entityId("Charles Babbage"),
    );
    const storyOf = new Map(body.citations.map((citation) => [citation.title, citation.story]));

    expect(storyOf.get(cited[0].title)).toMatchObject({ id: story.id, slug: "ada-and-babbage", title: "Ada and Babbage" });
    expect(storyOf.get(cited[1].title)).toBeNull();
    expect(storyOf.get(cited[2].title)).toBeNull();
  });

  // ADR-0018: metadata is open, bodies are internal. This drawer serves the metadata and
  // never the text, which is why the fixture below is the *most* permissive case there is —
  // a `licensed` Publisher and `licensed_full_text` on the row, the one pair `mayServeText`
  // clears. Text a reader may read is reachable through the Article record, where that gate
  // lives; a second place serving bodies would be a second place to get the gate wrong. The
  // mode is stated so a reader knows what Tessera holds without being handed it.
  it("serves an edge's citations as metadata, even where the Publisher cleared its text", async () => {
    const publisher = await createPublisher("licensed.example", "licensed");
    const text = "The licensed body of the report, which no graph surface may serve.";
    for (let index = 0; index < ENTITY_PROMOTION_FLOOR; index += 1) {
      const article = await createArticle(publisher.id, `licensed ${index}`, {
        analysisText: text,
        analysisTextMode: "licensed_full_text",
      });
      await annotate(article.id, ["Ada Lovelace", "Charles Babbage"]);
    }
    await runEntityResolution();

    const body = await citations(
      await reader("student"),
      await entityId("Ada Lovelace"),
      await entityId("Charles Babbage"),
    );

    expect(body.citations).toHaveLength(ENTITY_PROMOTION_FLOOR);
    expect(body.citations[0].analysisTextMode).toBe("licensed_full_text");
    // The projection by its whole key set, not by the absence of one name: a body served
    // under `excerpt`, `analysisText` or anything else would pass a narrower assertion.
    expect(Object.keys(body.citations[0]).sort()).toEqual([
      "analysisTextMode",
      "id",
      "publishedAt",
      "publisher",
      "story",
      "title",
      "url",
    ]);
    expect(JSON.stringify(body)).not.toContain("licensed body");
  });

  // A drawer is a list a person reads, so it is bounded like every other list here — and
  // the weight above it is the whole count, not the length of what fits. The two numbers
  // differing is the honest reading; the list silently being the graph's whole evidence is
  // not.
  it("bounds the list it opens, and states the weight it was bounded out of", async () => {
    const publisher = await createPublisher("wire.example");
    const cited = await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], EDGE_CITATION_CAP + 3);
    await runEntityResolution();

    const body = await citations(
      await reader("student"),
      await entityId("Ada Lovelace"),
      await entityId("Charles Babbage"),
    );

    expect(body.weight).toBe(EDGE_CITATION_CAP + 3);
    expect(body.citations).toHaveLength(EDGE_CITATION_CAP);
    // Bounded off the old end: the newest reporting is what the neighbourhood's window
    // states, so a bound that dropped it would open a list that disagrees with the page.
    expect(body.citations[0].title).toBe(cited[cited.length - 1].title);
  });

  // Every one of these is the same fact to a reader — the line they clicked is not in the
  // graph — and a pair with no edge is the one worth being careful about: an empty list
  // would assert a co-mention that was never reported.
  it("answers 404 for a pair the graph has no edge for, and for an id that is not one", async () => {
    const publisher = await createPublisher("wire.example");
    await coMention(publisher.id, ["Ada Lovelace", "Charles Babbage"], ENTITY_PROMOTION_FLOOR);
    await coMention(publisher.id, ["Grace Hopper", "Charles Babbage"], ENTITY_PROMOTION_FLOOR);
    await runEntityResolution();

    const token = await reader("student");
    const ada = await entityId("Ada Lovelace");
    const grace = await entityId("Grace Hopper");

    // Ada and Grace are both in the graph and were never reported together; a name paired
    // with itself is no edge either, since a self-pair is a row the schema refuses.
    for (const url of [edgeUrl(ada, grace), edgeUrl(ada, ada), edgeUrl(ada, randomUUID()), edgeUrl(ada, "not-a-uuid")]) {
      const res = await request(app()).get(url).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404);
    }
  });

  // The facet carries into the drawer, because the drawer is opened *from* a faceted
  // picture: a line drawn at weight five that opens eight reports would be the page
  // contradicting itself one click later.
  it("opens the reporting the facet leaves, so the weight stated is the list served", async () => {
    const publisher = await createPublisher("wire.example");
    const pair = ["Ada Lovelace", "Charles Babbage"];
    const under = await coMention(publisher.id, pair, ENTITY_PROMOTION_FLOOR, "under");
    const outside = await coMention(publisher.id, pair, 3, "outside");
    for (const article of under) await annotate(article.id, ["ECON_STOCKMARKET"], "theme");
    for (const article of outside) await annotate(article.id, ["MANMADE_DISASTER"], "theme");
    await runEntityResolution();

    const body = await citations(
      await reader("student"),
      await entityId("Ada Lovelace"),
      await entityId("Charles Babbage"),
      "?theme=ECON_STOCKMARKET",
    );

    expect(body.weight).toBe(ENTITY_PROMOTION_FLOOR);
    expect(body.citations.map((citation) => citation.title)).toEqual(
      [...under].reverse().map((article) => article.title),
    );
    expect(body.citations.map((citation) => citation.url)).not.toContain(outside[0].url);
  });
});


