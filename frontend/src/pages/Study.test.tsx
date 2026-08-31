import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Study from "./Study";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";
import type { Flashcard, StudyDeck } from "../api/client";

const card: Flashcard = {
  id: "card-1",
  question: "What do the outlets agree on?",
  answer: "The pilot line targets production in 2027.",
  claimType: "consensus",
  citations: [
    {
      evidenceId: "A1",
      articleId: "article-1",
      title: "Pilot line targets 2027 output",
      publisherName: "Meridian Wire",
    },
  ],
  storyId: "story-1",
  storyTitle: "Semiconductor alliance moves to fabrication",
  generationRunId: "run-1",
  repetitions: 0,
  easeFactor: 2.5,
  intervalDays: 0,
  dueAt: "2026-03-01T09:30:00Z",
  lastReviewedAt: null,
};

const dueDeck: StudyDeck = { items: [card], dueCount: 1, totalCount: 1, nextDueAt: null };

describe("Study flashcards", () => {
  it("renders the shared pending state while the due deck loads", () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));

    renderWithProviders(<Study />, { route: "/study", path: "/study" });

    expect(screen.getByRole("status")).toHaveTextContent("Loading your flashcards");
  });

  it("renders the shared retryable error state", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "database unavailable" }, 500));

    renderWithProviders(<Study />, { route: "/study", path: "/study" });

    expect(await screen.findByRole("alert")).toHaveTextContent("database unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("states how to make a first deck when the Student owns no cards", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ items: [], dueCount: 0, totalCount: 0, nextDueAt: null } satisfies StudyDeck),
    );

    renderWithProviders(<Study />, { route: "/study", path: "/study" });

    expect(await screen.findByText(/No flashcards yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse Stories" })).toHaveAttribute("href", "/stories");
    expect(screen.getByRole("link", { name: "Brief" })).toHaveAttribute("href", "/briefs");
  });

  it("states when the next card returns when none are due", async () => {
    const nextDueAt = "2026-03-08T09:30:00Z";
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ items: [], dueCount: 0, totalCount: 3, nextDueAt } satisfies StudyDeck),
    );

    renderWithProviders(<Study />, { route: "/study", path: "/study" });

    expect(await screen.findByText(/Nothing due/)).toHaveTextContent("You have 3 cards in hand");
    expect(screen.getByText(new Date(nextDueAt).toLocaleDateString())).toHaveAttribute("datetime", nextDueAt);
  });

  it("keeps the cited answer hidden until recall, then records the outcome", async () => {
    const nextDueAt = "2026-03-02T09:30:00Z";
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === "POST") return jsonResponse({ ...card, repetitions: 1, intervalDays: 1, dueAt: nextDueAt });
      // The invalidation after review gets the completed session. Before it, the card
      // is due. Fetch calls are sequential at this seam, so the count says which.
      const getCalls = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method !== "POST").length;
      return jsonResponse(
        getCalls === 1 ? dueDeck : { items: [], dueCount: 0, totalCount: 1, nextDueAt },
      );
    });

    const user = userEvent.setup();
    renderWithProviders(<Study />, { route: "/study", path: "/study" });

    expect(await screen.findByText(card.question)).toBeInTheDocument();
    expect(screen.queryByText(card.answer)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show answer" }));

    expect(screen.getByText(card.answer)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "A1 · Meridian Wire" })).toHaveAttribute(
      "href",
      "/articles/article-1",
    );
    expect(screen.getByRole("link", { name: card.storyTitle })).toHaveAttribute("href", "/stories/story-1");

    await user.click(screen.getByRole("button", { name: "Good" }));

    await waitFor(() => expect(screen.getByText(/Nothing due/)).toBeInTheDocument());
    const review = vi
      .mocked(fetch)
      .mock.calls.find(([, options]) => options?.method === "POST");
    expect(review?.[0]).toBe("/api/v1/flashcards/card-1/reviews");
    expect(JSON.parse(String(review?.[1]?.body))).toEqual({ grade: 4 });
  });
});
