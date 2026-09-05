import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EntityNeighbourhood from "./EntityNeighbourhood";
import type { EdgeCitations, Neighbourhood } from "../api/client";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

// #69. Cytoscape is stubbed for the reason it is on the global view: jsdom has no canvas, so
// what is asserted is everything the page owes a reader besides the picture — the profile, the
// depth it drew to, the facet, the names in words, and the reporting under one link.
const destroy = vi.fn();
const on = vi.fn();
vi.mock("cytoscape", () => ({ default: vi.fn(() => ({ destroy, on })) }));

const view: Neighbourhood = {
  retainedDays: 7,
  promotionFloor: 5,
  depth: 1,
  focus: {
    id: "e1",
    kind: "organization",
    canonicalName: "Reserve Bank",
    aliases: ["reserve bank of australia"],
    articleCount: 18,
    from: "2026-08-26T06:00:00Z",
    to: "2026-09-01T18:00:00Z",
  },
  theme: null,
  themes: [
    { theme: "ECON_INTEREST_RATE", articleCount: 11 },
    { theme: "EPU_POLICY", articleCount: 4 },
  ],
  neighbourCount: 2,
  nodes: [
    { id: "e1", canonicalName: "Reserve Bank", kind: "organization", articleCount: 18 },
    { id: "e2", canonicalName: "Ada Lovelace", kind: "person", articleCount: 11 },
    { id: "e3", canonicalName: "Canberra", kind: "location", articleCount: 6 },
  ],
  edges: [
    { entityAId: "e1", entityBId: "e2", weight: 9 },
    { entityAId: "e1", entityBId: "e3", weight: 4 },
    { entityAId: "e2", entityBId: "e3", weight: 2 },
  ],
};

const citations: EdgeCitations = {
  weight: 9,
  citations: [
    {
      id: "a1",
      title: "Rates held for a third meeting",
      url: "https://wire.example/rates",
      publishedAt: "2026-09-01T18:00:00Z",
      analysisTextMode: "metadata_only",
      publisher: { id: "p1", name: "Wire Service", domain: "wire.example" },
      story: { id: "s1", slug: "rates-decision", title: "The rates decision" },
    },
    {
      id: "a2",
      title: "A quieter read on inflation",
      url: "https://wire.example/inflation",
      publishedAt: "2026-08-30T09:00:00Z",
      analysisTextMode: "metadata_only",
      publisher: { id: "p1", name: "Wire Service", domain: "wire.example" },
      story: null,
    },
  ],
};

// The page makes two different requests — the neighbourhood, then one link's evidence when a
// reader opens it — so the stub answers by URL rather than in call order: an assertion about
// the drawer must not depend on which request React fired first.
function render(overrides: Partial<Neighbourhood> = {}, { route = "/graph/entities/e1", evidence = citations } = {}) {
  vi.mocked(fetch).mockImplementation((input) =>
    Promise.resolve(
      String(input).includes("/edges/")
        ? jsonResponse(evidence)
        : jsonResponse({ ...view, ...overrides }),
    ),
  );
  return renderWithProviders(<EntityNeighbourhood />, { route, path: "/graph/entities/:entityId" });
}

describe("An Entity's neighbourhood — UI states", () => {
  it("says it is reading the neighbourhood while the request is in flight", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<EntityNeighbourhood />, {
      route: "/graph/entities/e1",
      path: "/graph/entities/:entityId",
    });

    expect(screen.getByRole("status")).toHaveTextContent("Reading this Entity");
  });

  // A name a merge folded away or a pass demoted arrives as the 404 the endpoint answers with.
  it("carries a name the graph no longer holds through as the error it is, with a retry", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "Entity not found" }, 404))
      .mockResolvedValueOnce(jsonResponse(view));

    renderWithProviders(<EntityNeighbourhood />, {
      route: "/graph/entities/e1",
      path: "/graph/entities/:entityId",
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this Entity: Entity not found");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { name: "Reserve Bank", level: 1 })).toBeInTheDocument();
  });

  // The acceptance criterion's own empty state, and the reason it cannot be the promotion
  // floor's: the name is in the graph, and the reporting its links rested on is not.
  it("states an Entity whose links have all rolled out of the retained window as the window, not as a floor", async () => {
    render({
      focus: { ...view.focus, articleCount: 0, from: null, to: null },
      neighbourCount: 0,
      nodes: [view.nodes[0]],
      edges: [],
    });

    expect(await screen.findByText(/rolled out of the last 7 days/)).toBeInTheDocument();
    expect(screen.getByText("Reporting").closest("div")).toHaveTextContent("None inside the retained window");
    expect(screen.getByText("Drawn").closest("div")).toHaveTextContent("No names");
    // Not a failure, and not a rule this name has already cleared.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/5 separate reports/)).not.toBeInTheDocument();
    // Nothing to draw and nothing to list: a dot joined to nothing asserts nothing.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Reported alongside" })).not.toBeInTheDocument();
  });

  // The other empty neighbourhood, and the one a reader can undo: their own filter emptied it.
  it("blames the Theme rather than the window when a facet narrows the neighbourhood to nothing", async () => {
    render(
      {
        focus: { ...view.focus, articleCount: 0, from: null, to: null },
        theme: "EPU_POLICY",
        neighbourCount: 0,
        nodes: [view.nodes[0]],
        edges: [],
      },
      { route: "/graph/entities/e1?theme=EPU_POLICY" },
    );

    expect(await screen.findByText(/No reporting filed under EPU_POLICY/)).toBeInTheDocument();
    expect(screen.getByText(/Clear the Theme/)).toBeInTheDocument();
    expect(screen.queryByText(/rolled out of the last/)).not.toBeInTheDocument();
  });
});

describe("An Entity's neighbourhood — the profile and its bounds", () => {
  it("states the Entity's kind, the names folded into it, and how much reporting it was seen in", async () => {
    render();

    expect(await screen.findByRole("heading", { name: "Reserve Bank", level: 1 })).toBeInTheDocument();
    // Scoped to the masthead's own ledger by a term only it carries: "Kind" and "Reporting"
    // are terms in every register row below too, which is the point — the same facts are
    // stated per neighbour there and about this name up here.
    const ledger = within(screen.getByText("Depth").closest("dl")!);
    expect(ledger.getByText("Kind").closest("div")).toHaveTextContent("organization");
    // Aliases are held normalized, and are shown as what they are rather than as spellings
    // GDELT reported.
    expect(ledger.getByText("Also known as").closest("div")).toHaveTextContent("reserve bank of australia");
    expect(ledger.getByText("Reporting").closest("div")).toHaveTextContent("18 reports cited");
    expect(
      [...ledger.getByText("Reporting").closest("div")!.querySelectorAll("time")].map((el) =>
        el.getAttribute("dateTime"),
      ),
    ).toEqual(["2026-08-26T06:00:00Z", "2026-09-01T18:00:00Z"]);
  });

  it("says so when no other spelling has been folded into the name", async () => {
    render({ focus: { ...view.focus, aliases: [] } });

    expect(await screen.findByText(/No other spelling has been merged into this name/)).toBeInTheDocument();
  });

  // Depth is invisible in a layout, so the page states it: everything drawn was reported
  // alongside this name itself.
  it("states the depth it drew to and the bound it drew under", async () => {
    render({ neighbourCount: 9 });

    expect(await screen.findByText("Depth")).toBeInTheDocument();
    expect(screen.getByText("Depth").closest("div")).toHaveTextContent("1 hop from this name");
    expect(screen.getByText("Drawn").closest("div")).toHaveTextContent("2 of 9 names");
    expect(screen.getByText(/Showing the 2 names most reported alongside this one/)).toBeInTheDocument();
  });

  it("claims no bound when it drew every name reported alongside", async () => {
    render();

    expect(await screen.findByText("Drawn")).toBeInTheDocument();
    expect(screen.getByText("Drawn").closest("div")).toHaveTextContent("All 2 names");
    expect(screen.queryByText(/Showing the 2 names most reported/)).not.toBeInTheDocument();
  });

  // The price of AGENTS.md's exemption for the graph read seam, paid on this surface too: the
  // corpus named, in the same two rows the global view states it in.
  it("names the corpus it read and the window that bounds it, and offers the way back to the graph", async () => {
    render();

    expect(await screen.findByText("Corpus")).toBeInTheDocument();
    expect(screen.getByText("Corpus").closest("div")).toHaveTextContent(
      "GDELT firehose, plus Tessera’s Curated Corpus",
    );
    expect(screen.getByText("Retention window").closest("div")).toHaveTextContent(
      "Rolling 7 days of firehose metadata",
    );
    expect(screen.getByRole("link", { name: "Back to the knowledge graph" })).toHaveAttribute("href", "/graph");
  });
});

describe("An Entity's neighbourhood — the names alongside it", () => {
  it("registers every drawn neighbour with its tie to the focus, and opens each one's own neighbourhood", async () => {
    render();

    const register = await screen.findByRole("region", { name: "Reported alongside" });
    const rows = within(register).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".entry-title")?.textContent)).toEqual([
      "Ada Lovelace",
      "Canberra",
    ]);
    expect(within(register).getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/graph/entities/e2",
    );
    // The focus is the page, not a row in its own register.
    expect(within(register).queryByText("Reserve Bank")).not.toBeInTheDocument();
    // The weight the picture draws as line width, in words — and the interlink the picture
    // draws between the two neighbours, counted.
    expect(rows[0]).toHaveTextContent("Reported together9 reports");
    expect(rows[0]).toHaveTextContent("Reporting11 reports");
    expect(rows[0]).toHaveTextContent("Other links drawn1");
    expect(rows[1]).toHaveTextContent("Reported together4 reports");
  });

  it("draws the picture around the focus and says in its label what it drew", async () => {
    render();

    expect(await screen.findByRole("img")).toHaveAccessibleName(
      "A force-directed graph of Reserve Bank and the 2 names reported alongside it, joined by 3 co-mention links. Every name it draws is listed in words below it, and opens that name's own neighbourhood.",
    );
    // Only the kinds actually drawn, each with the names it accounts for.
    const key = screen.getByRole("list", { name: "What each shape in the graph is" });
    expect(within(key).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "person · 1",
      "organization · 1",
      "location · 1",
    ]);
  });
});

describe("An Entity's neighbourhood — Themes as a facet", () => {
  it("offers the Themes this name is reported under, with the reporting behind each, and never draws one", async () => {
    render();

    const facet = await screen.findByRole("combobox", { name: /Theme/ });
    expect([...facet.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All themes",
      "ECON_INTEREST_RATE · 11",
      "EPU_POLICY · 4",
    ]);
    // ADR-0028: a Theme is a filter, never a node.
    const register = screen.getByRole("region", { name: "Reported alongside" });
    expect(within(register).queryByText(/ECON_INTEREST_RATE/)).not.toBeInTheDocument();
  });

  it("narrows the neighbourhood by the Theme selected, in the address bar", async () => {
    render();
    const facet = await screen.findByRole("combobox", { name: /Theme/ });

    await userEvent.selectOptions(facet, "ECON_INTEREST_RATE");

    // The narrowed request the page made, and the narrowed reading it is now on.
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain(
      "/api/v1/graph/entities/e1?theme=ECON_INTEREST_RATE",
    );
    // The facet travels with a reader walking on to the next name.
    expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/graph/entities/e2?theme=ECON_INTEREST_RATE",
    );
  });

  it("keeps a Theme it was linked into as the filter in force, even when the name is not in its own head of the vocabulary", async () => {
    render({ theme: "WB_2024_ANTI_CORRUPTION" }, { route: "/graph/entities/e1?theme=WB_2024_ANTI_CORRUPTION" });

    const facet = await screen.findByRole("combobox", { name: /Theme/ });
    expect(facet).toHaveValue("WB_2024_ANTI_CORRUPTION");
    expect(screen.getByText(/Narrowed to reporting filed under WB_2024_ANTI_CORRUPTION/)).toBeInTheDocument();
  });
});

describe("An Entity's neighbourhood — the reporting under one link", () => {
  it("keeps nested citation headlines from collapsing their name track", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toMatch(/\.entry\s*\{[^}]*grid-template-columns:\s*minmax\(min\(16ch,\s*100%\),\s*1fr\)\s+minmax\(0,\s*auto\);/s);
    expect(styles).toMatch(/\.entry:has\(\.entry-cover\)\s*\{[^}]*minmax\(min\(16ch,\s*100%\),\s*1fr\)\s+minmax\(0,\s*auto\)/s);
    expect(styles).toMatch(/\.entry:has\(\.entry-action\)\s*\{[^}]*minmax\(min\(16ch,\s*100%\),\s*1fr\)\s+minmax\(0,\s*auto\)/s);
    expect(styles).toMatch(/\.entry-register\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  });

  it("opens the Articles a link was observed in, each linking to somewhere it can be read", async () => {
    render();
    const register = await screen.findByRole("region", { name: "Reported alongside" });
    const row = within(register).getAllByRole("listitem")[0];

    await userEvent.click(within(row).getByRole("button", { name: "Show reporting" }));

    expect(await screen.findByRole("link", { name: "Rates held for a third meeting" })).toHaveAttribute(
      "href",
      "/articles/a1",
    );
    // Newest first, as the endpoint ordered them.
    const opened = within(row).getAllByRole("listitem");
    expect(opened.map((item) => item.querySelector(".entry-title")?.textContent)).toEqual([
      "Rates held for a third meeting",
      "A quieter read on inflation",
    ]);
    expect(opened[0]).toHaveTextContent("Wire Service");
    // The corpus this graph reads is the firehose, so a citation may sit in no Story at all —
    // stated either way rather than left as a missing row.
    expect(opened[0]).toHaveTextContent("StoryThe rates decision");
    expect(within(opened[0]).getByRole("link", { name: "The rates decision" })).toHaveAttribute(
      "href",
      "/stories/s1",
    );
    expect(opened[1]).toHaveTextContent("Not in a Story · reads at wire.example");
    // And its title goes where it can actually be read: the Article record exists for exactly
    // the reporting a Story has accepted, so this one's only reading is the original.
    expect(within(opened[1]).getByRole("link", { name: "A quieter read on inflation" })).toHaveAttribute(
      "href",
      "https://wire.example/inflation",
    );
  });

  it("states the whole weight of the link beside the reporting it lists", async () => {
    render();
    const register = await screen.findByRole("region", { name: "Reported alongside" });

    await userEvent.click(within(register).getAllByRole("button", { name: "Show reporting" })[0]);

    expect(
      await screen.findByText(
        /The 2 most recent of 9 reports that named Reserve Bank and Ada Lovelace together/,
      ),
    ).toBeInTheDocument();
  });

  it("claims no bound when the link's whole reporting is on screen", async () => {
    render({}, { evidence: { weight: 2, citations: citations.citations } });
    const register = await screen.findByRole("region", { name: "Reported alongside" });

    await userEvent.click(within(register).getAllByRole("button", { name: "Show reporting" })[0]);

    expect(
      await screen.findByText(/All 2 reports that named Reserve Bank and Ada Lovelace together/),
    ).toBeInTheDocument();
  });

  it("reads the link's evidence under the facet in force", async () => {
    render({ theme: "ECON_INTEREST_RATE" }, { route: "/graph/entities/e1?theme=ECON_INTEREST_RATE" });
    const register = await screen.findByRole("region", { name: "Reported alongside" });

    await userEvent.click(within(register).getAllByRole("button", { name: "Show reporting" })[0]);
    await screen.findByRole("link", { name: "Rates held for a third meeting" });

    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain(
      "/api/v1/graph/entities/e1/edges/e2?theme=ECON_INTEREST_RATE",
    );
  });

  it("says it is reading the reporting, and offers a retry when that request is the one that fails", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).includes("/edges/")
        ? Promise.resolve(jsonResponse({ error: "Could not read the citations" }, 500))
        : Promise.resolve(jsonResponse(view)),
    );
    renderWithProviders(<EntityNeighbourhood />, {
      route: "/graph/entities/e1",
      path: "/graph/entities/:entityId",
    });
    const register = await screen.findByRole("region", { name: "Reported alongside" });

    await userEvent.click(within(register).getAllByRole("button", { name: "Show reporting" })[0]);

    // The neighbourhood itself is untouched by a link's failure: the page is still readable.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the reporting behind this link: Could not read the citations",
    );
    expect(screen.getByRole("heading", { name: "Reserve Bank", level: 1 })).toBeInTheDocument();
  });

  // The graph rebuilds hourly and the picture was read one request earlier, so a link whose last
  // citation aged out in between is gone by the time it is opened. The endpoint 404s that pair,
  // and a reader is owed the absence rather than a failed request they could retry forever.
  it("reads a link that rolled out of the window since the picture was drawn as an absence, not a failure", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).includes("/edges/")
        ? Promise.resolve(jsonResponse({ error: "Edge not found" }, 404))
        : Promise.resolve(jsonResponse(view)),
    );
    renderWithProviders(<EntityNeighbourhood />, {
      route: "/graph/entities/e1",
      path: "/graph/entities/:entityId",
    });
    const register = await screen.findByRole("region", { name: "Reported alongside" });

    await userEvent.click(within(register).getAllByRole("button", { name: "Show reporting" })[0]);

    expect(
      await screen.findByText(/is no longer in the retained window/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes the reporting again, and says which state the command is in", async () => {
    render();
    const register = await screen.findByRole("region", { name: "Reported alongside" });
    const row = within(register).getAllByRole("listitem")[0];
    const command = within(row).getByRole("button", { name: "Show reporting" });
    expect(command).toHaveAttribute("aria-expanded", "false");
    // The panel the command names exists before it is opened: a reference into nothing is a
    // reference a screen reader cannot follow.
    expect(document.getElementById(command.getAttribute("aria-controls")!)).toBeInTheDocument();

    await userEvent.click(command);
    await screen.findByRole("link", { name: "Rates held for a third meeting" });
    expect(within(row).getByRole("button", { name: "Hide reporting" })).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(within(row).getByRole("button", { name: "Hide reporting" }));

    expect(screen.queryByRole("link", { name: "Rates held for a third meeting" })).not.toBeInTheDocument();
  });

  // The open drawer is a reading a reader can share, which is why it is in the address bar
  // rather than in component state — and why a line tapped between two neighbours has somewhere
  // to land (below).
  it("opens the link named in the address, and puts an opened one there", async () => {
    render({}, { route: "/graph/entities/e1?link=e3" });
    const register = await screen.findByRole("region", { name: "Reported alongside" });
    const rows = within(register).getAllByRole("listitem");

    expect(within(rows[1]).getByRole("button", { name: "Hide reporting" })).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain(
      "/api/v1/graph/entities/e1/edges/e3",
    );

    // And a name walked on to carries the reading with it: the facet, but not a link belonging
    // to the page being left.
    expect(within(rows[0]).getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/graph/entities/e2",
    );
  });

  // so the handler it was handed is called directly — there is no canvas in jsdom to click.
  function tapper() {
    return on.mock.calls
      .filter(([event, selector]) => event === "tap" && selector === "edge")
      .at(-1)![2] as (event: unknown) => void;
  }

  it("opens the reporting behind a tie tapped in the picture, from either end it was stored at", async () => {
    render();
    await screen.findByRole("img");
    const tapEdge = tapper();

    // Tapped from the end it was stored at — and again from the other, since which name sorted
    // into `entityAId` is storage's business, not the reader's.
    act(() => tapEdge({ target: { data: () => ({ source: "e1", target: "e2" }) } }));

    const register = screen.getByRole("region", { name: "Reported alongside" });
    const rows = within(register).getAllByRole("listitem");
    expect(await screen.findByRole("link", { name: "Rates held for a third meeting" })).toBeInTheDocument();
    expect(within(rows[0]).getByRole("button", { name: "Hide reporting" })).toBeInTheDocument();

    act(() => tapEdge({ target: { data: () => ({ source: "e3", target: "e1" }) } }));

    expect(within(rows[1]).getByRole("button", { name: "Hide reporting" })).toBeInTheDocument();
    expect(within(rows[0]).getByRole("button", { name: "Show reporting" })).toBeInTheDocument();
  });

  // A line between two neighbours is theirs rather than this page's, and this page has no row to
  // open it under — so instead of swallowing the tap it walks the reader to the page the line
  // *is* a tie on, with the same evidence already open.
  it("walks a line between two neighbours to the page it is a tie on, with its reporting open", async () => {
    const ada: Neighbourhood = {
      ...view,
      focus: { ...view.focus, id: "e2", kind: "person", canonicalName: "Ada Lovelace", articleCount: 11 },
      neighbourCount: 2,
      edges: [
        { entityAId: "e2", entityBId: "e3", weight: 2 },
        { entityAId: "e1", entityBId: "e2", weight: 9 },
      ],
    };
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/edges/")) return Promise.resolve(jsonResponse(citations));
      return Promise.resolve(jsonResponse(url.includes("/entities/e2") ? ada : view));
    });
    renderWithProviders(<EntityNeighbourhood />, {
      route: "/graph/entities/e1",
      path: "/graph/entities/:entityId",
    });
    await screen.findByRole("img");

    act(() => tapper()({ target: { data: () => ({ source: "e2", target: "e3" }) } }));

    expect(await screen.findByRole("heading", { name: "Ada Lovelace", level: 1 })).toBeInTheDocument();
    const rows = within(screen.getByRole("region", { name: "Reported alongside" })).getAllByRole("listitem");
    const canberra = rows.find((row) => row.textContent?.startsWith("Canberra"))!;
    expect(within(canberra).getByRole("button", { name: "Hide reporting" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Rates held for a third meeting" })).toBeInTheDocument();
  });
});
