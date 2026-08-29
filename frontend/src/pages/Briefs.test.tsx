import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Briefs from "./Briefs";
import { jsonResponse, listEnvelope, renderWithProviders } from "../test/renderWithProviders";

const brief = {
  id: "b1",
  title: "Supply chain watch",
  note: null,
  category: "technology" as const,
  articleCapacityLimit: 20,
  coverImageKey: null,
  coverImageUrl: null,
  ownerId: "u1",
  articleCount: 3,
  createdAt: "2026-01-02T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

// The URL the most recent render actually asked the API for — the
// filter/sort/pagination contract is only real if the controls reach the query
// string.
function lastRequestedUrl(): string {
  return vi.mocked(fetch).mock.calls.at(-1)![0] as string;
}

describe("Briefs list — UI states", () => {
  it("shows a loading state while the first page is in flight", async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Briefs />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading your Briefs…");
  });

  it("shows an empty state with a call to action when the owner has no Briefs", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([])));

    renderWithProviders(<Briefs />);

    expect(await screen.findByText(/You have no Briefs yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute("href", "/briefs/new");
  });

  it("offers Clear filters, not the create prompt, when a filter emptied the list", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([])));

    renderWithProviders(<Briefs />, { route: "/briefs?category=health" });

    expect(await screen.findByText("No Briefs match these filters.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(screen.getByText(/You have no Briefs yet/)).toBeInTheDocument());
  });

  it("shows an error state with a working retry when the request fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "Database is down" }, 500))
      .mockResolvedValueOnce(jsonResponse(listEnvelope([brief])));

    renderWithProviders(<Briefs />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load Briefs: Database is down");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("link", { name: "Supply chain watch" })).toBeInTheDocument();
  });

  it("renders the populated state with each Brief's capacity", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([brief])));

    renderWithProviders(<Briefs />);

    const entry = await screen.findByRole("listitem");
    expect(within(entry).getByRole("link", { name: "Supply chain watch" })).toHaveAttribute("href", "/briefs/b1");
    expect(within(entry).getByText("technology")).toBeInTheDocument();
    expect(within(entry).getByText("3/20 articles")).toBeInTheDocument();
  });
});

// jsdom does no layout, so "the row holds its shape" is a browser check, not a
// test. What it can hold is the content contract either side of it: a cover
// appears where the Brief has one and nothing is rendered where it doesn't.
describe("Briefs list — cover images", () => {
  // jsdom implements no object URLs, and the cover endpoint is owner-only so its
  // bytes arrive as a blob rather than as an <img src>.
  const covered = {
    ...brief,
    id: "b2",
    title: "Grid watch",
    coverImageKey: "briefs/b2/cover.png",
    coverImageUrl: "/api/v1/briefs/b2/cover-image",
  };

  beforeEach(() => {
    // jsdom implements neither object-URL method, and the two the hook calls are
    // the only ones anything here uses — so they are assigned rather than the
    // whole URL global stubbed, which would take the constructor with it.
    URL.createObjectURL = () => "blob:cover";
    URL.revokeObjectURL = () => {};
  });

  it("shows a cover where the Brief has one and none where it does not", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([brief, covered])));

    renderWithProviders(<Briefs />);

    const [plain, withCover] = await screen.findAllByRole("listitem");
    // querySelector because a cover is decorative (alt=""), so it has no
    // accessible role to query by — the entry's title names the record.
    await waitFor(() => expect(withCover.querySelector("img")).toBeInTheDocument());
    expect(plain.querySelector("img")).not.toBeInTheDocument();
  });
});

describe("Briefs list — advanced controls (story 34)", () => {
  it("sends category, date range, sort, and page to the API", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([brief], { totalPages: 3 })));

    renderWithProviders(<Briefs />);
    await screen.findByRole("link", { name: "Supply chain watch" });

    await userEvent.selectOptions(screen.getByLabelText("Category"), "technology");
    await waitFor(() => expect(lastRequestedUrl()).toContain("category=technology"));

    await userEvent.type(screen.getByLabelText("Created from"), "2026-01-01");
    await waitFor(() => expect(lastRequestedUrl()).toContain("dateFrom=2026-01-01"));

    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "title");
    await userEvent.selectOptions(screen.getByLabelText("Direction"), "asc");
    await waitFor(() => expect(lastRequestedUrl()).toContain("sort=title%3Aasc"));

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastRequestedUrl()).toContain("page=2"));
  });

  it("disables Previous on the first page and Next on the last", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(listEnvelope([brief], { totalPages: 1 })));

    renderWithProviders(<Briefs />);
    await screen.findByRole("link", { name: "Supply chain watch" });

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
