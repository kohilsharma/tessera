import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysisRegister } from "./analysisRegister";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";
import type { Analysis, UserRole } from "../api/client";

const analysis: Analysis = {
  id: "run-1",
  storyId: "story-1",
  lens: "student_context",
  promptVersion: "2026-09-03",
  status: "completed",
  failureCode: null,
  articleCount: 2,
  distinctPublisherCount: 2,
  evidence: [
    {
      evidenceId: "A1",
      articleId: "article-1",
      title: "Pilot line targets 2027 output",
      url: "https://meridian.example/report",
      publishedAt: "2026-01-04T00:00:00Z",
      publisher: { id: "publisher-1", name: "Meridian Wire", domain: "meridian.example" },
      sourceRank: 1,
      selectionReason: "centroid_rank",
      excerpt: "The pilot line targets 2027 output.",
    },
  ],
  claims: [
    {
      id: "claim-1",
      claimType: "consensus",
      text: "The pilot line targets production in 2027.",
      citations: ["A1"],
      citationSides: null,
    },
  ],
  completedAt: "2026-03-01T09:30:00Z",
};

function identity(role: UserRole) {
  return { id: `${role}-1`, email: `${role}@tessera.example`, role };
}

describe("Analysis flashcard command", () => {
  it("lets a Student make cards from the same run a Story or Brief displays", async () => {
    vi.mocked(fetch).mockImplementation(async (_input, init) =>
      init?.method === "POST"
        ? jsonResponse({
            generationRunId: analysis.id,
            storyId: analysis.storyId,
            storyTitle: "Semiconductor alliance",
            cards: [],
          }, 201)
        : jsonResponse(identity("student")),
    );
    const user = userEvent.setup();

    renderWithProviders(<AnalysisRegister analysis={analysis} />, { route: "/story", path: "/story" });

    await user.type(await screen.findByLabelText("Study focus (optional)"), "Focus on the policy timeline");
    await user.click(screen.getByRole("button", { name: "Make flashcards" }));

    await waitFor(() => {
      const create = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === "POST");
      expect(create?.[0]).toBe("/api/v1/flashcards");
      expect(JSON.parse(String(create?.[1]?.body))).toEqual({
        generationRunId: analysis.id,
        studyDetail: "Focus on the policy timeline",
      });
    });
  });

  it.each(["investor", "admin"] as const)("does not offer the Student command to an %s", async (role) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(identity(role)));

    renderWithProviders(<AnalysisRegister analysis={analysis} />);

    await screen.findByText(analysis.claims[0].text);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Make flashcards" })).not.toBeInTheDocument();
  });
});
