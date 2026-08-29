import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import StoryDetail from "./StoryDetail";
import ArticleDetail from "./ArticleDetail";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";
import type { ArticleDetail as ArticleRecord } from "../api/client";

// The Record archetype is presentation, and jsdom judges no presentation. What
// it holds is the content contract the archetype exists to carry: the facts the
// masthead ledger states, the provenance on each listed Article, and the way
// back out — a record page that stops stating its mode, its coverage window, or
// its exit has stopped being a record, however it looks.
// The pending and error treatments are #30's shared components, covered by the
// Briefs and Search tests; not re-covered here.

const publisher = { id: "p1", name: "Meridian Wire", domain: "meridianwire.example" };

const article = {
  id: "a1",
  title: "Pilot line targets 2027 output",
  url: "https://meridianwire.example/pilot-line",
  publishedAt: "2026-01-04T00:00:00Z",
  analysisTextMode: "feed_excerpt" as const,
  publisher,
};

const story = {
  id: "s1",
  slug: "semiconductor-alliance",
  title: "Semiconductor alliance moves to fabrication",
  summary: "Four Publishers report a pilot target.",
  category: "technology" as const,
  firstSeenAt: "2026-01-02T00:00:00Z",
  lastSeenAt: "2026-01-09T00:00:00Z",
  articleCount: 2,
  articles: [article, { ...article, id: "a2", title: "Subsidy timing still unresolved" }],
};

function renderStory() {
  vi.mocked(fetch).mockResolvedValue(jsonResponse(story));
  return renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });
}

const articleRecord: ArticleRecord = {
  ...article,
  analysisText: "The pilot line is scheduled for 2027.",
  story: { id: "s1", slug: story.slug, title: story.title },
};

function renderArticle(overrides: Partial<ArticleRecord> = {}) {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...articleRecord, ...overrides }));
  return renderWithProviders(<ArticleDetail />, { route: "/articles/a1", path: "/articles/:id" });
}

describe("Story detail — the record masthead", () => {
  it("states category and the coverage window beside the Story's title", async () => {
    renderStory();

    expect(await screen.findByRole("heading", { level: 1, name: story.title })).toBeInTheDocument();
    expect(screen.getByText("technology")).toBeInTheDocument();
    expect(screen.getByText("2 articles")).toBeInTheDocument();
    expect(screen.getByText(new Date(story.firstSeenAt).toLocaleDateString())).toBeInTheDocument();
    expect(screen.getByText(new Date(story.lastSeenAt).toLocaleDateString())).toBeInTheDocument();
  });

  it("lists each Article with its Publisher and publication date", async () => {
    renderStory();

    const entries = await screen.findAllByRole("listitem");
    expect(entries).toHaveLength(2);
    const entry = within(entries[0]);
    expect(entry.getByRole("link", { name: article.title })).toHaveAttribute("href", "/articles/a1");
    expect(entry.getByText(publisher.name)).toBeInTheDocument();
    expect(entry.getByText(new Date(article.publishedAt).toLocaleDateString())).toBeInTheDocument();
  });

  it("offers the way back to the Stories index", async () => {
    renderStory();

    expect(await screen.findByRole("link", { name: "Back to Stories" })).toHaveAttribute(
      "href",
      "/stories",
    );
  });
});

describe("Article detail — the record's own terms", () => {
  it("states its Analysis Text Mode in words, not as the raw mode", async () => {
    renderArticle();

    expect(await screen.findByText("Feed excerpt")).toBeInTheDocument();
    expect(screen.queryByText("feed_excerpt")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Tessera holds the headline and excerpt from this Publisher's feed/),
    ).toBeInTheDocument();
  });

  it("states that body text is never redistributed, and links the original", async () => {
    renderArticle();

    expect(await screen.findByText(/never redistributed or republished/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: `Read the original at ${publisher.domain}` }),
    ).toHaveAttribute("href", article.url);
  });

  it("says the text is withheld when Tessera holds none to show", async () => {
    renderArticle({ analysisText: null, analysisTextMode: "licensed_full_text" });

    expect(await screen.findByText(/held for analysis only/)).toBeInTheDocument();
    expect(screen.getByText("Licensed full text")).toBeInTheDocument();
  });

  it("shows a mode it does not describe rather than throwing on it", async () => {
    // The union is the backend's, and it can grow: a mode this page has no words
    // for is still a fact about the record, so it appears instead of blanking it.
    renderArticle({ analysisTextMode: "syndicated_wire" as ArticleRecord["analysisTextMode"] });

    expect(await screen.findByText("syndicated_wire")).toBeInTheDocument();
  });

  it("goes back to its parent Story, not the Stories index", async () => {
    renderArticle();

    expect(await screen.findByRole("link", { name: `Back to ${story.title}` })).toHaveAttribute(
      "href",
      "/stories/s1",
    );
  });
});
