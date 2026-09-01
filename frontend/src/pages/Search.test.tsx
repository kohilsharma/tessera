import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Search from "./Search";
import { jsonResponse, listEnvelope, renderWithProviders } from "../test/renderWithProviders";

const result = {
  id: "a1",
  title: "Fab announces new packaging line",
  url: "https://meridianwire.example/fab-line",
  publishedAt: "2026-01-02T00:00:00Z",
  analysisTextMode: "manual_fixture" as const,
  publisher: { id: "p1", name: "Meridian Wire", domain: "meridianwire.example" },
  story: { id: "s1", slug: "packaging-capacity", title: "Packaging capacity race" },
  score: 0.9,
};

function lastRequestedUrl(): string {
  return vi.mocked(fetch).mock.calls.at(-1)![0] as string;
}

describe("Search view — UI states", () => {
  it("prompts for a term before it searches anything", () => {
    renderWithProviders(<Search />);

    expect(screen.getByText(/Enter a search term/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a loading state while a search is in flight", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Search />, { route: "/search?q=packaging" });

    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  });

  it("shows an empty state naming the term that matched nothing", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([])));

    renderWithProviders(<Search />, { route: "/search?q=nothingmatches" });

    expect(await screen.findByText(/No Articles match/)).toHaveTextContent("nothingmatches");
  });

  it("shows an error state with a working retry when the search fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "Search is unavailable" }, 500))
      .mockResolvedValueOnce(jsonResponse(listEnvelope([result])));

    renderWithProviders(<Search />, { route: "/search?q=packaging" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not run this search: Search is unavailable");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("link", { name: result.title })).toBeInTheDocument();
  });

  it("renders results with their publisher and Story", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([result])));

    renderWithProviders(<Search />, { route: "/search?q=packaging" });

    expect(await screen.findByRole("link", { name: result.title })).toHaveAttribute("href", "/articles/a1");
    expect(screen.getByRole("listitem")).toHaveTextContent("Meridian Wire");
    expect(screen.getByRole("link", { name: "Packaging capacity race" })).toHaveAttribute("href", "/stories/s1");
  });

  it("keeps the search term when filters are cleared", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([])));

    renderWithProviders(<Search />, { route: "/search?q=packaging&category=health" });

    await userEvent.click(await screen.findByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(lastRequestedUrl()).toContain("q=packaging"));
    expect(lastRequestedUrl()).not.toContain("category=");
    expect(screen.getByLabelText("Search")).toHaveValue("packaging");
  });

  // #65: the other reading of the same query. It carries the whole query, filters
  // included — switching how you read a search must never mean typing it again.
  it("offers the timeline reading of the query it is already showing", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([result])));

    renderWithProviders(<Search />, { route: "/search?q=packaging&category=technology" });

    expect(await screen.findByRole("link", { name: "Read as a timeline" })).toHaveAttribute(
      "href",
      "/search/timeline?q=packaging&category=technology",
    );
  });
});
