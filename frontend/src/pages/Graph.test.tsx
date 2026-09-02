import { describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import Graph from "./Graph";
import type { GraphView } from "../api/client";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

// #68. jsdom has no canvas, so Cytoscape is stubbed and what is asserted is everything
// the page owes a reader *besides* the picture: which corpus this is and over what
// window, that the bound is stated rather than hidden, the kinds in a legend, and the
// same graph in words underneath. That is not a workaround — those are the readings a
// keyboard and a screen reader get, and the picture is the one part of the page that
// carries nothing they cannot reach.
//
// `on` is captured rather than ignored: the tap handler the stub is handed is the canvas's
// only behaviour, and calling it is the only way to check where a node opens (#69).
const destroy = vi.fn();
const on = vi.fn();
vi.mock("cytoscape", () => ({ default: vi.fn(() => ({ destroy, on })) }));

const node = (id: string, canonicalName: string, kind: GraphView["nodes"][number]["kind"], articleCount: number) => ({
  id,
  canonicalName,
  kind,
  articleCount,
});

// A graph drawn from a wider working set than it shows, so the page has a bound to state:
// three of five names, one of each kind.
const view: GraphView = {
  retainedDays: 7,
  promotionFloor: 5,
  entityCount: 5,
  articleCount: 24,
  from: "2026-08-26T06:00:00Z",
  to: "2026-09-01T18:00:00Z",
  nodes: [
    node("e1", "Reserve Bank", "organization", 18),
    node("e2", "Ada Lovelace", "person", 11),
    node("e3", "Canberra", "location", 6),
  ],
  edges: [
    { entityAId: "e1", entityBId: "e2", weight: 9 },
    { entityAId: "e1", entityBId: "e3", weight: 4 },
  ],
};

function render(
  overrides: Partial<GraphView> = {},
  options: { probe?: { path: string; element: ReactElement } } = {},
) {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...view, ...overrides }));
  return renderWithProviders(<Graph />, { route: "/graph", path: "/graph", ...options });
}

describe("Knowledge graph — UI states", () => {
  it("says it is reading the graph while the request is in flight", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Graph />, { route: "/graph" });

    expect(screen.getByRole("status")).toHaveTextContent("Reading the graph");
  });

  it("offers a retry when the request fails, and does not call it an empty graph", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("server unavailable"))
      .mockResolvedValueOnce(jsonResponse(view));

    renderWithProviders(<Graph />, { route: "/graph" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the knowledge graph");
    expect(screen.queryByText(/No name has been resolved/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("states a graph nothing has been resolved into as the rule that would fill it", async () => {
    render({ nodes: [], edges: [], entityCount: 0, articleCount: 0, from: null, to: null });

    expect(await screen.findByText(/No name has been resolved into the graph yet/)).toBeInTheDocument();
    // An empty graph is not a failure and says so by not being one.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/5 separate reports/)).toBeInTheDocument();
    expect(screen.getByText(/last 7 days/)).toBeInTheDocument();
  });

  // The second empty graph, and the one the promotion floor does not explain: names cleared
  // the floor, nothing co-cited them, and the view draws no isolate. Telling this reader
  // "no name has been resolved" would state the opposite of what they are looking at.
  it("distinguishes a graph with names but no links from one with no names at all", async () => {
    render({ nodes: [], edges: [], entityCount: 5, articleCount: 0, from: null, to: null });

    expect(await screen.findByText(/5 names have been resolved/)).toBeInTheDocument();
    expect(screen.getByText(/no two names have yet been reported together/)).toBeInTheDocument();
    expect(screen.queryByText(/No name has been resolved/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Knowledge graph — the corpus it reads", () => {
  it("states which corpus and which window before it draws anything", async () => {
    render();

    // The distinction the whole page turns on: this is not the curated corpus the rest
    // of Tessera reads.
    expect(await screen.findByText(/retained firehose/)).toBeInTheDocument();
    expect(screen.getByText(/wider and rougher body of reporting than the Stories/)).toBeInTheDocument();

    // Scoped to the ledger: "Reporting" is a term in every register row too, which is the
    // point — the same fact is stated per name below and over the whole graph up here.
    const ledger = within(screen.getByText("Corpus").closest("dl")!);
    expect(ledger.getByText("Corpus").closest("div")).toHaveTextContent("GDELT firehose");
    expect(ledger.getByText("Retention window").closest("div")).toHaveTextContent(
      "Rolling 7 days of firehose metadata",
    );
    expect(ledger.getByText("Reporting").closest("div")).toHaveTextContent("24 reports cited");
  });

  // Retention expires `metadata_only` GDELT rows and nothing else (CONTEXT.md, Retention
  // Window), so the Curated Corpus and anything a Story or a Brief holds can be cited from
  // outside the rolling window. The rule and the span are separate rows for that reason, and
  // the span the page states is the one the endpoint measured. Asserted on `dateTime` rather
  // than the rendered text, which is `toLocaleDateString` and so belongs to the runtime.
  it("states the retention rule apart from the span of reporting it actually cites", async () => {
    render({ from: "2026-07-02T06:00:00Z", to: "2026-09-01T18:00:00Z" });

    const ledger = within((await screen.findByText("Corpus")).closest("dl")!);
    const retention = ledger.getByText("Retention window").closest("div")!;
    const reporting = ledger.getByText("Reporting").closest("div")!;

    // A 61-day span under a 7-day rule: the rule must not be stamped across it.
    expect([...reporting.querySelectorAll("time")].map((el) => el.getAttribute("dateTime"))).toEqual([
      "2026-07-02T06:00:00Z",
      "2026-09-01T18:00:00Z",
    ]);
    expect(reporting).toHaveTextContent("24 reports cited");
    expect(retention).toHaveTextContent("Rolling 7 days of firehose metadata");
    expect(retention.querySelector("time")).toBeNull();
  });

  it("states the bound it drew under rather than implying the graph is three names wide", async () => {
    render();

    expect(await screen.findByText("Drawn")).toBeInTheDocument();
    expect(screen.getByText("Drawn").closest("div")).toHaveTextContent("3 of 5 names");
    expect(screen.getByText(/Showing the 3 most reported names/)).toBeInTheDocument();
  });

  it("claims no bound when it drew the whole working set", async () => {
    render({ entityCount: 3 });

    expect(await screen.findByText("Drawn")).toBeInTheDocument();
    expect(screen.getByText("Drawn").closest("div")).toHaveTextContent("All 3 names");
    expect(screen.queryByText(/Showing the 3 most reported/)).not.toBeInTheDocument();
  });
});

describe("Knowledge graph — the picture and its reading in words", () => {
  it("names every kind it drew, and only the kinds it drew", async () => {
    render();

    const key = await screen.findByRole("list", { name: "What each shape in the graph is" });
    expect(within(key).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "person · 1",
      "organization · 1",
      "place · 1",
    ]);
  });

  it("draws the graph as a labelled picture, with what it draws stated in words", async () => {
    render();

    const plot = await screen.findByRole("img");
    expect(plot).toHaveAccessibleName(
      "A force-directed graph of 3 names joined by 2 co-mention links. Every name it draws is listed in words below it, and opens that name's own neighbourhood.",
    );
  });

  it("registers every drawn name with its kind, its reporting and its links, each opening its own neighbourhood", async () => {
    render();

    const register = await screen.findByRole("region", { name: "Names in the graph" });
    const rows = within(register).getAllByRole("listitem");
    // Most reported first, which is the order the view ranked them in. Each name is the link
    // out to that name's neighbourhood (#69) — the reachability a canvas tap cannot give a
    // keyboard or a screen reader.
    expect(rows.map((row) => row.querySelector(".entry-title")?.textContent)).toEqual([
      "Reserve Bank",
      "Ada Lovelace",
      "Canberra",
    ]);
    expect(within(register).getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/graph/entities/e2",
    );
    // The two quantities the picture encodes as node size and line width, in words:
    // nothing on this page is stated by the drawing alone.
    expect(rows[0]).toHaveTextContent("18 reports");
    expect(rows[0]).toHaveTextContent("organization");
    expect(rows[0]).toHaveTextContent("Links drawn2");
    expect(rows[0]).toHaveTextContent("Strongest linkAda Lovelace · 9 reports");
    expect(rows[2]).toHaveTextContent("Links drawn1");
    expect(rows[2]).toHaveTextContent("Strongest linkReserve Bank · 4 reports");
  });

  it("states a zero for a name whose every tie was to a name outside the bound, and no strongest link", async () => {
    render({ edges: [] });

    const register = await screen.findByRole("region", { name: "Names in the graph" });
    expect(within(register).getAllByRole("listitem")[0]).toHaveTextContent("Links drawn0");
    expect(screen.queryByText("Strongest link")).not.toBeInTheDocument();
  });

  // The first acceptance criterion of #69, on the surface it is reached from: tapping a name
  // opens that name's neighbourhood. Cytoscape is stubbed, so the handler it was handed is
  // called directly — there is no canvas in jsdom to click, and the handler is the whole of
  // the behaviour.
  it("opens a name's own neighbourhood when its node is tapped", async () => {
    render({}, { probe: { path: "/graph/entities/:entityId", element: <p>Neighbourhood reached</p> } });
    await screen.findByRole("img");

    // Selected by the selector it was registered for: the plot also wires a handler for a
    // tapped *line*, which this page hands it nothing to do (#69 does).
    const [, , handler] = on.mock.calls.filter(([event, selector]) => event === "tap" && selector === "node").at(-1) as [
      string,
      string,
      (e: unknown) => void,
    ];
    act(() => handler({ target: { id: () => "e2" } }));

    expect(await screen.findByText("Neighbourhood reached")).toBeInTheDocument();
  });
});
