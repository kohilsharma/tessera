import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import SearchTimeline from "./SearchTimeline";
import { TimelineMoved } from "../App";
import type { SearchTimelineResult } from "../api/client";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

// #65. What this page owes the reader is the grouping and the axis: matching reporting
// laid on one shared axis, in a lane per Story, each lane a way into the Story it belongs
// to. jsdom judges no bar heights, so what is asserted is what the bars *say* — the
// accessible name every volume row carries — plus the lanes, their order, and the switch
// back to the ranked reading of the same query.
//
// #96 promoted it to its own destination and made the bars the way in rather than a
// picture of the way in. jsdom still judges no heights, so what is asserted there is the
// bars' semantics — one radio group per row, one radio per period, each naming its own
// span and count — and what selecting one does to the lanes underneath.

const publisher = { id: "p1", name: "Meridian Wire", domain: "meridianwire.example" };

const point = (id: string, title: string, publishedAt: string, storyId: string) => ({
  id,
  title,
  url: `https://meridianwire.example/${id}`,
  publishedAt,
  analysisTextMode: "feed_excerpt" as const,
  publisher,
  storyId,
});

// Two Stories reported in overlapping weeks — the case the lanes exist for. Each lane's
// volume is index-aligned with the timeline's own, which is what makes the second column
// mean the same period in both.
const timeline: SearchTimelineResult = {
  from: "2026-01-05T00:00:00Z",
  to: "2026-01-26T00:00:00Z",
  granularity: "week",
  points: [
    point("a1", "Alliance moves to fabrication", "2026-01-05T00:00:00Z", "s1"),
    point("a2", "Second fab site shortlisted", "2026-01-12T00:00:00Z", "s1"),
    point("a3", "Tariff schedule published", "2026-01-13T00:00:00Z", "s2"),
  ],
  events: [],
  volume: [
    { periodStart: "2026-01-05T00:00:00Z", count: 1 },
    { periodStart: "2026-01-12T00:00:00Z", count: 2 },
    { periodStart: "2026-01-19T00:00:00Z", count: 0 },
  ],
  lanes: [
    { story: { id: "s1", slug: "semiconductor-alliance", title: "Semiconductor alliance" }, volume: [1, 1, 0] },
    { story: { id: "s2", slug: "tariff-schedule", title: "Tariff schedule" }, volume: [0, 1, 0] },
  ],
  total: 3,
};

function render(overrides: Partial<SearchTimelineResult> = {}, route = "/timeline?q=fabrication") {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...timeline, ...overrides }));
  return renderWithProviders(<SearchTimeline />, { route });
}

// #96 moved the page's address. The old one is kept, and what is worth a check is not that
// it forwards — react-router does that — but that the query survives the trip, since
// `Navigate` drops the search string unless it is put back by hand.
describe("Search timeline — the address it used to have", () => {
  const Landed = () => <p>landed at {useLocation().search}</p>;

  it("forwards the old path to the new one, carrying the query", () => {
    renderWithProviders(<TimelineMoved />, {
      route: "/search/timeline?q=fabrication&category=technology",
      path: "/search/timeline",
      probe: { path: "/timeline", element: <Landed /> },
    });

    expect(screen.getByText("landed at ?q=fabrication&category=technology")).toBeInTheDocument();
  });
});

describe("Search timeline — UI states", () => {
  // The landing state of a top-level destination (#96): a reader who arrives from the nav
  // has typed nothing, so it has to say what the page draws, where the term goes, and
  // where to find one — not merely that something is missing.
  it("says what a timeline is and how to draw one before it has a term", () => {
    renderWithProviders(<SearchTimeline />, { route: "/timeline" });

    expect(screen.getByText(/one lane per Story/)).toBeInTheDocument();
    expect(screen.getByText(/Search/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the Stories" })).toHaveAttribute("href", "/stories");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("states the wait while the timeline is being assembled", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<SearchTimeline />, { route: "/timeline?q=fabrication" });

    expect(screen.getByRole("status")).toHaveTextContent("Laying the matches on a timeline…");
  });

  // The two empty screens are different facts, and the page says so: nothing matched the
  // query is not the same as the request failed.
  it("names the term that matched nothing, and offers to widen the filters", async () => {
    render({ from: null, to: null, points: [], volume: [], lanes: [], total: 0 }, "/timeline?q=zeppelin&category=health");

    expect(await screen.findByText(/No reporting matches/)).toHaveTextContent("zeppelin");
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).not.toContain("category="));
    // Clearing the filters keeps the term the results are of, as on /search.
    expect(screen.getByLabelText("Search")).toHaveValue("zeppelin");
  });

  it("offers a working retry when the timeline could not be built", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "Search is unavailable" }, 500))
      .mockResolvedValueOnce(jsonResponse(timeline));

    renderWithProviders(<SearchTimeline />, { route: "/timeline?q=fabrication" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not build this timeline: Search is unavailable",
    );

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("link", { name: "Semiconductor alliance" })).toBeInTheDocument();
  });
});

describe("Search timeline — one lane per Story", () => {
  it("gives each Story its own lane, in the order its coverage began", async () => {
    render();

    const lanes = await screen.findAllByRole("region");
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toHaveAccessibleName("Semiconductor alliance");
    expect(lanes[1]).toHaveAccessibleName("Tariff schedule");
  });

  it("lists a lane's own matching reporting under it, and nobody else's", async () => {
    render();

    const lane = within(await screen.findByRole("region", { name: "Semiconductor alliance" }));
    const rows = lane.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Alliance moves to fabrication");
    expect(rows[1]).toContain("Second fab site shortlisted");
    expect(rows[1]).toContain(publisher.name);
    expect(lane.queryByText("Tariff schedule published")).not.toBeInTheDocument();
    // The reporting stays a way into the Article behind it, as on every other register.
    expect(lane.getByRole("link", { name: "Alliance moves to fabrication" })).toHaveAttribute(
      "href",
      "/articles/a1",
    );
  });

  it("routes a lane into the Story it is a lane of", async () => {
    render();

    expect(await screen.findByRole("link", { name: "Semiconductor alliance" })).toHaveAttribute(
      "href",
      "/stories/s1",
    );
    expect(screen.getByRole("link", { name: "Tariff schedule" })).toHaveAttribute("href", "/stories/s2");
  });

  // The bars are the whole reading of the axis for a screen-reader user, and a lane's
  // bars only mean anything beside another lane's if both state the axis they share.
  it("states in words what each lane's bars draw, and that they share one axis", async () => {
    render();

    const rows = await screen.findAllByRole("radiogroup");
    expect(rows[0]).toHaveAccessibleName(/All matching reporting per week across 3 periods/);
    expect(rows[1]).toHaveAccessibleName(
      "Semiconductor alliance: 2 matching reports per week, on the same axis as every other Story here.",
    );
    const lane = within(screen.getByRole("region", { name: "Tariff schedule" }));
    expect(lane.getByText("1 matching report")).toBeInTheDocument();
  });

  // A timeline is a set and cannot page, so the cap is stated rather than hidden.
  it("says when it is showing the most relevant matches rather than all of them", async () => {
    render({ total: 240 });

    expect(await screen.findByText(/Showing the 3 most relevant of 240 matches/)).toBeInTheDocument();
  });

  it("does not claim a cap when it is showing every match", async () => {
    render();

    expect(await screen.findByText(/Matching reporting per week across 2 Stories/)).toBeInTheDocument();
    expect(screen.queryByText(/most relevant of/)).not.toBeInTheDocument();
  });

  it("hands the whole query back to the ranked reading of it", async () => {
    render({}, "/timeline?q=fabrication&category=technology&dateFrom=2026-01-01");

    expect(await screen.findByRole("link", { name: "Read as a ranked list" })).toHaveAttribute(
      "href",
      "/search?q=fabrication&category=technology&dateFrom=2026-01-01",
    );
  });

  it("narrows the axis by the date range, not just the rows under it", async () => {
    render();

    await userEvent.type(await screen.findByLabelText("Published from"), "2026-01-12");

    await waitFor(() => expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain("dateFrom=2026-01-12"));
  });
});

// #96. The bars were a picture of the way in; the way in was the list underneath. Each
// one is now a radio in its row's group, which is what makes a row a single tab stop the
// arrow keys move inside rather than sixty of them — and picking one narrows every lane
// to that period without touching the axis they are all drawn against.
describe("Search timeline — the bars are the way in", () => {
  // The whole set's row, not a lane's: every row draws the same buckets and any of them
  // picks the period, so the assertions drive the one that stands for all the reporting.
  const periods = async () =>
    within(await screen.findByRole("radiogroup", { name: /All matching reporting/ })).getAllByRole("radio");

  it("names the span and the count every bar stands for", async () => {
    render();

    const bars = await periods();
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveAccessibleName(/^Week of .+: 1 report$/);
    expect(bars[1]).toHaveAccessibleName(/^Week of .+: 2 reports$/);
    // A lull is a period like any other — selectable, so a reader can ask who was quiet.
    expect(bars[2]).toHaveAccessibleName(/^Week of .+: 0 reports$/);
    expect(bars.every((bar) => !(bar as HTMLInputElement).checked)).toBe(true);
  });

  it("narrows every lane to the period a bar picks, and says what it narrowed to", async () => {
    render();

    await userEvent.click((await periods())[1]);

    expect(screen.getByRole("status")).toHaveTextContent(/Narrowed to Week of .+: 2 of 3 matching reports/);
    const alliance = within(screen.getByRole("region", { name: "Semiconductor alliance" }));
    expect(alliance.getAllByRole("listitem")).toHaveLength(1);
    expect(alliance.getByRole("link", { name: "Second fab site shortlisted" })).toBeInTheDocument();
    // The lane still states the whole it is a part of, so a narrowed lane cannot read as
    // a Story with less coverage than it has.
    expect(alliance.getByText("1 of 2 matching reports")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Tariff schedule" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("says which Stories were quiet in the period rather than dropping their lane", async () => {
    render();

    await userEvent.click((await periods())[0]);

    const tariff = within(screen.getByRole("region", { name: "Tariff schedule" }));
    expect(tariff.getByText("No matching reporting in this period.")).toBeInTheDocument();
    expect(tariff.queryAllByRole("listitem")).toHaveLength(0);
    // Its bars survive, so the lane is still a way to pick another period.
    expect(tariff.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("gives every period back", async () => {
    render();

    await userEvent.click((await periods())[0]);
    await userEvent.click(screen.getByRole("button", { name: "Show every period" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Tariff schedule" })).getAllByRole("listitem")).toHaveLength(1);
  });

  // One tab stop per row, arrow keys inside it — the browser's own radio-group
  // behaviour, which is the whole reason a bar is a radio and not a button.
  it("moves between periods with the arrow keys", async () => {
    render();

    await userEvent.click((await periods())[0]);
    await userEvent.keyboard("{ArrowRight}");

    expect((await periods())[1]).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("2 of 3 matching reports");
  });

  // The period rides in the URL, so a narrowed axis is a link. A term or a filter that
  // draws a different axis leaves that value naming no bucket at all, and a stale
  // selection must resolve to no selection rather than to whichever bucket is nearby.
  it("selects nothing for a period the drawn axis does not have", async () => {
    render({}, "/timeline?q=fabrication&period=2020-06-01T00:00:00.000Z");

    expect((await periods()).every((bar) => !(bar as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Semiconductor alliance" })).getAllByRole("listitem")).toHaveLength(2);
  });
});
