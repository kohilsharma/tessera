import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchTimeline from "./SearchTimeline";
import type { SearchTimelineResult } from "../api/client";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

// #65. What this page owes the reader is the grouping and the axis: matching reporting
// laid on one shared axis, in a lane per Story, each lane a way into the Story it belongs
// to. jsdom judges no bar heights, so what is asserted is what the bars *say* — the
// accessible name every volume row carries — plus the lanes, their order, and the switch
// back to the ranked reading of the same query.

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

function render(overrides: Partial<SearchTimelineResult> = {}, route = "/search/timeline?q=fabrication") {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...timeline, ...overrides }));
  return renderWithProviders(<SearchTimeline />, { route });
}

describe("Search timeline — UI states", () => {
  it("prompts for a term before it lays anything on an axis", () => {
    renderWithProviders(<SearchTimeline />, { route: "/search/timeline" });

    expect(screen.getByText(/Enter a search term/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("states the wait while the timeline is being assembled", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<SearchTimeline />, { route: "/search/timeline?q=fabrication" });

    expect(screen.getByRole("status")).toHaveTextContent("Laying the matches on a timeline…");
  });

  // The two empty screens are different facts, and the page says so: nothing matched the
  // query is not the same as the request failed.
  it("names the term that matched nothing, and offers to widen the filters", async () => {
    render({ from: null, to: null, points: [], volume: [], lanes: [], total: 0 }, "/search/timeline?q=zeppelin&category=health");

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

    renderWithProviders(<SearchTimeline />, { route: "/search/timeline?q=fabrication" });

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

    const overlays = await screen.findAllByRole("img");
    expect(overlays[0]).toHaveAccessibleName(/All matching reporting per week across 3 periods/);
    expect(overlays[1]).toHaveAccessibleName(
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
    render({}, "/search/timeline?q=fabrication&category=technology&dateFrom=2026-01-01");

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
