import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Stories from "./Stories";
import { jsonResponse, listEnvelope, renderWithProviders } from "../test/renderWithProviders";

const story = {
  id: "s1",
  slug: "grid-interconnection-queue",
  title: "Grid interconnection queue reform",
  summary: null,
  category: "technology" as const,
  firstSeenAt: "2026-01-02T00:00:00Z",
  lastSeenAt: "2026-01-09T00:00:00Z",
  articleCount: 4,
  coverageSpectrum: { left: 1, centre: 2, right: 1, unrated: 0, total: 4, blindspot: null },
};

// The Index archetype is presentation, and jsdom cannot judge presentation. What
// it can hold is what this ticket actually changed in behaviour: the entry's
// content contract (an entry that stops carrying its category, coverage count,
// or first-seen date has stopped being scannable), the position statement, and
// the two empty states, which used to bleed into each other. The pending and
// error treatments are #30's shared components, already covered by the Briefs
// and Search tests — not re-covered here.
describe("Stories index — the entry register", () => {
  it("shows each Story's category, coverage count, and first-seen date", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([story], { total: 4, totalPages: 1 })));

    renderWithProviders(<Stories />);

    const entry = await screen.findByRole("listitem");
    expect(within(entry).getByRole("link", { name: story.title })).toHaveAttribute("href", "/stories/s1");
    expect(within(entry).getByText("technology")).toBeInTheDocument();
    expect(within(entry).getByText("4 articles")).toBeInTheDocument();
    expect(within(entry).getByText(new Date(story.firstSeenAt).toLocaleDateString())).toBeInTheDocument();
  });

  it("states the reader's position in the result set", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(listEnvelope([story], { page: 2, total: 24, totalPages: 3 })),
    );

    renderWithProviders(<Stories />, { route: "/stories?page=2" });

    expect(await screen.findByText("Entries 11–20 of 24 · Page 2 of 3")).toBeInTheDocument();
  });
});

describe("Stories index — the two empty states", () => {
  it("tells an unfiltered reader the corpus needs seeding, with nothing to clear", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([])));

    renderWithProviders(<Stories />);

    expect(await screen.findByText(/The corpus is empty/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("offers Clear filters, not the seeding note, when a filter emptied the list", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([])));

    renderWithProviders(<Stories />, { route: "/stories?category=health" });

    expect(await screen.findByText("No Stories match these filters.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(screen.getByText(/The corpus is empty/)).toBeInTheDocument());
  });
});
