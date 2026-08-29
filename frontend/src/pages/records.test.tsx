import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import StoryDetail from "./StoryDetail";
import ArticleDetail from "./ArticleDetail";
import BriefDetail from "./BriefDetail";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";
import type { ArticleDetail as ArticleRecord, BriefDetail as BriefRecord } from "../api/client";

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


// Brief detail is the same archetype registered as owned (#34). jsdom judges no
// stock and no layout, so what it holds is the content contract that carries the
// distinction in words: whose the Brief is, what it holds, and that the Articles
// in it are corpus records reachable as such.
const brief: BriefRecord = {
  id: "b1",
  title: "Supply chain watch",
  note: "Tracking the fabrication pivot.",
  category: "technology" as const,
  articleCapacityLimit: 20,
  coverImageKey: null,
  coverImageUrl: null,
  ownerId: "u1",
  articleCount: 1,
  createdAt: "2026-01-05T00:00:00Z",
  updatedAt: "2026-01-07T00:00:00Z",
  articles: [article],
};

function renderBrief(overrides: Partial<BriefRecord> = {}) {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...brief, ...overrides }));
  return renderWithProviders(<BriefDetail />, { route: "/briefs/b1", path: "/briefs/:id" });
}

describe("Brief detail — the owned artefact", () => {
  it("states the owner, category, and capacity beside the Brief's title and note", async () => {
    renderBrief();

    expect(await screen.findByRole("heading", { level: 1, name: brief.title })).toBeInTheDocument();
    expect(screen.getByText("Tracking the fabrication pivot.")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("technology")).toBeInTheDocument();
    expect(screen.getByText("1/20 articles")).toBeInTheDocument();
  });

  it("says so in the capacity when the Brief is full, and stops offering the attach", async () => {
    renderBrief({ articleCapacityLimit: 1 });

    expect(await screen.findByText("1/1 articles · full")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /Article id/ })).toBeDisabled();
  });

  it("marks its Articles as corpus records and reaches them as such", async () => {
    renderBrief();

    expect(await screen.findByText(/corpus Articles, held globally and owned by nobody/)).toBeInTheDocument();
    const entry = within(screen.getByRole("listitem"));
    expect(entry.getByRole("link", { name: article.title })).toHaveAttribute("href", "/articles/a1");
    expect(entry.getByText(publisher.name)).toBeInTheDocument();
    expect(entry.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("offers edit, delete, and the way back to My Briefs", async () => {
    renderBrief();

    expect(await screen.findByRole("link", { name: "Edit Brief" })).toHaveAttribute(
      "href",
      "/briefs/b1/edit",
    );
    expect(screen.getByRole("button", { name: "Delete Brief" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to My Briefs" })).toHaveAttribute("href", "/briefs");
  });

  it("shows the cover image where the Brief has one, and the plate's control either way", async () => {
    // Same object-URL stubs the Briefs index test needs: jsdom implements
    // neither, and the owner-only cover arrives as a blob rather than an src.
    URL.createObjectURL = () => "blob:cover";
    URL.revokeObjectURL = () => {};

    const { unmount } = renderBrief({
      coverImageKey: "briefs/b1/cover.png",
      coverImageUrl: "/api/v1/briefs/b1/cover-image",
    });
    expect(await screen.findByLabelText("Replace cover image")).toBeInTheDocument();
    // querySelector because a cover is decorative (alt=""), so it has no
    // accessible role to query by — the same reason the Briefs index test does.
    await waitFor(() => expect(document.querySelector("img")).toBeInTheDocument());
    unmount();

    renderBrief();
    expect(await screen.findByLabelText("Add a cover image")).toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });
});
