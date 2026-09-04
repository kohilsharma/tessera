import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StoryDetail from "./StoryDetail";
import ArticleDetail from "./ArticleDetail";
import BriefDetail from "./BriefDetail";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";
import type {
  ArticleDetail as ArticleRecord,
  BriefDetail as BriefRecord,
  MarketPanel,
  StoryAnalysis,
  Timeline,
} from "../api/client";

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
  coverageSpectrum: { left: 1, centre: 1, right: 0, unrated: 0, total: 2, blindspot: null },
  articles: [article, { ...article, id: "a2", title: "Subsidy timing still unresolved" }],
};

// #64. The timeline is a second GET on the same record, so every Story-detail render
// answers two — the record and its timeline — and `storyGet` is the one place that
// splits them.
const timeline: Timeline = {
  from: "2026-01-04T00:00:00Z",
  to: "2026-01-08T00:00:00Z",
  granularity: "day",
  points: [
    { ...article, storyId: story.id },
    { ...article, id: "a2", title: "Subsidy timing still unresolved", publishedAt: "2026-01-06T00:00:00Z", storyId: story.id },
  ],
  events: [
    { kind: "evidence_frozen", id: "e1", at: "2026-01-07T00:00:00Z", articleCount: 2 },
    { kind: "analysis_completed", id: "g1", at: "2026-01-08T00:00:00Z", lens: "student_context" },
  ],
  volume: [
    { periodStart: "2026-01-04T00:00:00Z", count: 1 },
    { periodStart: "2026-01-05T00:00:00Z", count: 0 },
    { periodStart: "2026-01-06T00:00:00Z", count: 1 },
    { periodStart: "2026-01-07T00:00:00Z", count: 0 },
    { periodStart: "2026-01-08T00:00:00Z", count: 0 },
  ],
};

const market: MarketPanel[] = [
  {
    entity: { id: "entity-1", canonicalName: "NVIDIA Corporation", ticker: "NVDA" },
    quote: {
      ticker: "NVDA",
      price: 101.25,
      change: 1.25,
      changePercent: 2.5,
      previousClose: 100,
      asOf: "2026-09-03T20:00:00Z",
      source: "mock",
    },
    indicators: { sma50: 98.5, rsi14: 61.2, volatility: 24.4 },
    series: [
      { date: "2026-09-01T00:00:00Z", close: 99, adjClose: 99 },
      { date: "2026-09-02T00:00:00Z", close: 100, adjClose: 100 },
    ],
  },
];

function storyGet(input: unknown, overrides: Partial<Timeline> = {}) {
  return jsonResponse(String(input).includes("/timeline") ? { ...timeline, ...overrides } : story);
}

function renderStory(overrides: Partial<Timeline> = {}) {
  vi.mocked(fetch).mockImplementation(async (input) => storyGet(input, overrides));
  return renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });
}

// #85: the fixture Publisher is unrated, which is the common case — AllSides
// rates nationally prominent outlets, and most of what ingestion finds is not one.
const articleRecord: ArticleRecord = {
  ...article,
  analysisText: "The pilot line is scheduled for 2027.",
  publisherLeaning: null,
  story: { id: "s1", slug: story.slug, title: story.title },
};

const allSidesRating: NonNullable<ArticleRecord["publisherLeaning"]> = {
  rating: "lean_left",
  label: "Lean Left",
  band: "left",
  source: {
    name: "AllSides",
    attribution: "AllSides Media Bias Ratings™. AllSides Technologies, Inc. Retrieved September 2026.",
    url: "https://www.allsides.com/media-bias/media-bias-ratings",
    licence: "CC BY-NC 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
  },
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

  // #64 folded the Articles register into the timeline: same rows, same provenance,
  // same link into each Article, now ordered against what was done with them.
  it("lists each Article with its Publisher and publication date", async () => {
    renderStory();

    const register = within(await screen.findByRole("region", { name: "Timeline" }));
    const entry = within(register.getAllByRole("listitem")[0]);
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

  it("shows the Investor market panel with an absolute and percentage day change", async () => {
    const investor = { id: "investor-1", email: "investor@example.com", role: "investor", colorMode: "light" };
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = String(input);
      if (path.includes("/auth/me")) return jsonResponse(investor);
      if (path.includes("/timeline")) return jsonResponse(timeline);
      return jsonResponse({ ...story, market, marketStatus: "ready", marketTotal: 2 });
    });

    renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });

    const panel = await screen.findByRole("region", { name: "Investor panel" });
    expect(panel).toHaveTextContent("Showing 1 of 2");
    expect(panel).toHaveTextContent("+$1.25 (+2.50%)");
    expect(panel).toHaveTextContent("50-day average");
  });

  it("renders only the panel belonging to the signed-in role", async () => {
    const adminPanel = {
      clusteringRun: null,
      latestAnalysis: { id: "run", lens: "student_context", promptVersion: "v1", status: "completed", completedAt: "2026-01-01T00:00:00Z" },
      mergeHistory: [],
    } as const;
    const responses = {
      student: { ...story, studentPanel: { collectionCount: 2 } },
      investor: { ...story, market, marketStatus: "ready", marketTotal: 1 },
      admin: { ...story, adminPanel },
    } as const;
    for (const role of ["student", "investor", "admin"] as const) {
      vi.mocked(fetch).mockImplementation(async (input) => {
        const path = String(input);
        if (path.includes("/auth/me")) return jsonResponse({ id: role, email: `${role}@example.com`, role, colorMode: "light" });
        if (path.includes("/timeline")) return jsonResponse(timeline);
        return jsonResponse(responses[role]);
      });
      const { unmount } = renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });
      const own = role === "student" ? "Student panel" : role === "investor" ? "Investor panel" : "Admin panel";
      expect(await screen.findByRole("region", { name: own })).toBeInTheDocument();
      for (const other of ["Student panel", "Investor panel", "Admin panel"].filter((name) => name !== own)) {
        expect(screen.queryByRole("region", { name: other })).not.toBeInTheDocument();
      }
      unmount();
    }
  });
});

// #64. The timeline's content contract: the Story's accepted reporting ordered
// against the analytical events that happened to it, each point still opening the
// Article behind it — and the two empty screens told apart, since "this Story has no
// datable reporting" and "the request failed" are different facts.
describe("Story detail — the timeline", () => {
  it("orders the reporting against the analysis the Story has been through", async () => {
    renderStory();

    const register = within(await screen.findByRole("region", { name: "Timeline" }));
    const rows = register.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain(article.title);
    expect(rows[1]).toContain("Subsidy timing still unresolved");
    expect(rows[2]).toContain("Evidence frozen");
    expect(rows[3]).toContain("Analysis completed");
    expect(rows[3]).toContain("Student context");
    // Each point still opens the Article behind it — a timeline is a way into the
    // reporting, not a picture of it.
    expect(register.getByRole("link", { name: article.title })).toHaveAttribute("href", "/articles/a1");
    // The volume overlay is the only reading of the axis a screen-reader user gets,
    // so it states what it draws.
    expect(register.getByRole("img")).toHaveAccessibleName(/across 5 periods, at most 1 in one/);
  });

  it("says in a line why tone is not on the axis", async () => {
    renderStory();

    const register = within(await screen.findByRole("region", { name: "Timeline" }));
    expect(register.getByText(/Tone is not shown/)).toHaveTextContent(/GDELT firehose also saw/);
  });

  it("states the wait while the timeline is being assembled", async () => {
    let answer: (value: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes("/timeline")
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : jsonResponse(story),
    );
    renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });

    const register = within(await screen.findByRole("region", { name: "Timeline" }));
    expect(register.getByRole("status")).toHaveTextContent(/Assembling this Story's timeline/);
    answer(jsonResponse(timeline));
    expect(await register.findByText("Evidence frozen")).toBeInTheDocument();
  });

  // A merge (#52) moves a Story's members away and repoints its runs, so a Story can
  // hold analytical events with no accepted reporting left. The API puts those on the
  // axis; saying "nothing here" over them would be saying it while holding them.
  it("keeps the analytical events on the axis when no reporting is left under them", async () => {
    renderStory({ points: [], volume: [], from: timeline.events[0].at, to: timeline.events[1].at });

    const register = within(await screen.findByRole("region", { name: "Timeline" }));
    expect(await register.findByText("Evidence frozen")).toBeInTheDocument();
    expect(register.getByText("Analysis completed")).toBeInTheDocument();
    expect(register.queryByText("This Story has no datable reporting yet.")).not.toBeInTheDocument();
    // And no overlay: the volume the API sends for this case is empty, and a ruled box
    // of zero-height bars would state a measurement of nothing.
    expect(register.queryByRole("img")).not.toBeInTheDocument();
  });

  it("distinguishes a Story with no datable reporting from a request that failed", async () => {
    renderStory({ from: null, to: null, points: [], events: [], volume: [] });

    const register = within(await screen.findByRole("region", { name: "Timeline" }));
    expect(await register.findByText("This Story has no datable reporting yet.")).toBeInTheDocument();
    expect(register.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a retry when the timeline itself could not be loaded", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes("/timeline")
        ? jsonResponse({ error: "Timeline unavailable" }, 500)
        : jsonResponse(story),
    );
    renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });

    const register = within(await screen.findByRole("region", { name: "Timeline" }));
    expect(await register.findByRole("alert")).toHaveTextContent("Timeline unavailable");
    expect(register.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // And the coverage list survives it: the Articles are on the record this page
    // already loaded, so a failed second request costs the ordering and the events,
    // never the reporting itself.
    expect(register.getByRole("link", { name: article.title })).toHaveAttribute("href", "/articles/a1");
    expect(screen.getByRole("heading", { level: 1, name: story.title })).toBeInTheDocument();
  });
});

// #53. The flagship's content contract on the page that carries it: an analysis is
// asked for rather than loaded, every claim it displays carries a citation a reader
// can open, and one that could not be produced says so instead of showing part of
// itself.
const analysis: StoryAnalysis = {
  id: "g1",
  storyId: story.id,
  lens: "student_context",
  promptVersion: "2026-09-01",
  status: "completed",
  failureCode: null,
  articleCount: 2,
  distinctPublisherCount: 2,
  evidence: [
    {
      evidenceId: "A1",
      articleId: "a1",
      title: article.title,
      url: article.url,
      publishedAt: article.publishedAt,
      publisher,
      sourceRank: 1,
      selectionReason: "earliest_reporting",
      excerpt: "The pilot line is scheduled for 2027.",
    },
    {
      evidenceId: "A2",
      articleId: "a2",
      title: "Subsidy timing still unresolved",
      publishedAt: article.publishedAt,
      url: "https://ledger.example/subsidy",
      publisher: { id: "p2", name: "Harbour Ledger", domain: "harbourledger.example" },
      sourceRank: 2,
      selectionReason: "latest_reporting",
      excerpt: null,
    },
  ],
  claims: [
    {
      id: "c1",
      claimType: "consensus",
      text: "Both outlets report a 2027 pilot target.",
      citations: ["A1", "A2"],
      citationSides: null,
    },
    {
      id: "c2",
      claimType: "student_context",
      text: "A pilot line proves a process before volume.",
      citations: ["A1"],
      citationSides: null,
    },
  ],
  completedAt: "2026-01-10T00:00:00Z",
  reused: false,
};

function renderStoryWithAnalysis(produced: StoryAnalysis) {
  vi.mocked(fetch).mockImplementation(async (input, init) =>
    init?.method === "POST" ? jsonResponse(produced) : storyGet(input),
  );
  return renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });
}

describe("Story detail — the analysis", () => {
  it("is asked for, then groups its claims by kind with a citation on each", async () => {
    renderStoryWithAnalysis(analysis);

    const command = await screen.findByRole("button", { name: "Request analysis" });
    // Nothing is generated on render: an analysis may cost money, so it happens
    // when a reader asks (ADR-0027).
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    await userEvent.click(command);

    expect(await screen.findByText(analysis.claims[0].text)).toBeInTheDocument();
    expect(screen.getByText("Where the reporting agrees")).toBeInTheDocument();
    // The reader's own Lens, labelled as itself rather than as "the other claim".
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText(analysis.claims[1].text)).toBeInTheDocument();
    // The invariant, followable: the evidence id resolves to the Article it cites,
    // on every claim that cites it.
    for (const link of screen.getAllByRole("link", { name: /A1 · Meridian Wire/ })) {
      expect(link).toHaveAttribute("href", "/articles/a1");
    }
    expect(screen.getByRole("link", { name: /A2 · Harbour Ledger/ })).toHaveAttribute("href", "/articles/a2");
    // And it states what the analysis was built from, since that is what "frozen
    // evidence" means to a reader.
    expect(screen.getByText(/2 Articles across 2 publishers/)).toBeInTheDocument();
  });

  it("states an analysis that could not be produced instead of showing part of it", async () => {
    renderStoryWithAnalysis({ ...analysis, status: "failed", failureCode: "invalid_citations", claims: [] });

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));

    const stated = await screen.findByRole("alert");
    expect(stated).toHaveTextContent(/unavailable/i);
    // A single untraceable claim is dropped rather than fatal (#54), so this state is
    // the harder one: too little survived to publish as an analysis at all.
    expect(stated).toHaveTextContent(/traced back to this Story's evidence/);
    expect(screen.queryByText("Where the reporting agrees")).not.toBeInTheDocument();
    // A failure is recoverable by asking again, so the command stays.
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("asks an Admin which Lens they are reading through, and nobody else", async () => {
    // An Admin is neither audience, so the API refuses an unnamed Lens from them —
    // a command that always 422s would be the defect this control prevents.
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === "POST") {
        expect(init.body).toBe(JSON.stringify({ lens: "investor_implication" }));
        return jsonResponse({ ...analysis, lens: "investor_implication" });
      }
      return String(input).includes("/auth/me")
        ? jsonResponse({ id: "u1", email: "a@b.c", role: "admin" })
        : storyGet(input);
    });
    renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });

    const lens = await screen.findByLabelText("Lens");
    await userEvent.selectOptions(lens, "investor_implication");
    await userEvent.click(screen.getByRole("button", { name: "Request analysis" }));

    expect(await screen.findByText(analysis.claims[0].text)).toBeInTheDocument();
  });

  it("offers a reader no Lens choice at all", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === "POST") {
        // A reader's Lens is derived from their role; sending one is refused.
        expect(init.body).toBe("{}");
        return jsonResponse(analysis);
      }
      return String(input).includes("/auth/me")
        ? jsonResponse({ id: "u2", email: "s@b.c", role: "student" })
        : storyGet(input);
    });
    renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));

    expect(await screen.findByText(analysis.claims[0].text)).toBeInTheDocument();
    expect(screen.queryByLabelText("Lens")).not.toBeInTheDocument();
  });

  // #55: the ownership loop, from this end. Saving is creating a Brief, so it is
  // offered to the roles that own one and it leaves the Story behind.
  it("saves the analysis into a Brief the reader owns", async () => {
    const posted: (BodyInit | null | undefined)[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === "POST") {
        posted.push(init.body);
        return jsonResponse(String(input).includes("/briefs") ? { ...brief, id: "b9" } : analysis);
      }
      return String(input).includes("/auth/me")
        ? jsonResponse({ id: "u2", email: "s@b.c", role: "student" })
        : storyGet(input);
    });
    renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save to a new Brief" }));

    // The run itself is what is saved — not the Story, and not the claims copied out
    // of it (ADR-0027).
    await waitFor(() => expect(posted).toContain(JSON.stringify({ generationRunId: analysis.id })));
    // And the reader lands on the Brief they now own, so the Story record is gone.
    await waitFor(() => expect(screen.queryByText(analysis.claims[0].text)).not.toBeInTheDocument());
  });

  it("offers an Admin no way to own the analysis they asked for", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === "POST") return jsonResponse(analysis);
      return String(input).includes("/auth/me")
        ? jsonResponse({ id: "u1", email: "a@b.c", role: "admin" })
        : storyGet(input);
    });
    renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));

    expect(await screen.findByText(analysis.claims[0].text)).toBeInTheDocument();
    // ADR-0004: an Admin owns no artefacts, so a command the API would 403 is not one
    // the console should offer.
    expect(screen.queryByRole("button", { name: "Save to a new Brief" })).not.toBeInTheDocument();
  });
});

// #56: the Investor reading of the same pipeline output. Not the Student view with
// different wording — the agreement/disagreement axis is what it foregrounds, and a
// disagreement is shown as two sides a reader can open.
const investorAnalysis: StoryAnalysis = {
  ...analysis,
  lens: "investor_implication",
  claims: [
    {
      id: "c1",
      claimType: "consensus",
      text: "Both outlets report a 2027 pilot target.",
      citations: ["A1", "A2"],
      citationSides: null,
    },
    {
      id: "c2",
      claimType: "source_specific",
      text: "Only one outlet names the subsidy deadline.",
      citations: ["A2"],
      citationSides: null,
    },
    {
      id: "c3",
      claimType: "contradiction",
      text: "The subsidy is signed.",
      citations: ["A1", "A2"],
      citationSides: [
        { relationship: "supports", citations: ["A1"] },
        { relationship: "contradicts", citations: ["A2"] },
      ],
    },
    {
      id: "c4",
      claimType: "investor_implication",
      text: "Unresolved subsidy timing keeps the capital plan provisional.",
      citations: ["A2"],
      citationSides: null,
    },
  ],
};

const groupHeadings = () =>
  screen
    .getAllByText(
      /^(Where the reporting agrees|Where it disagrees|Reported by one outlet only|Context|Investor implication)$/,
    )
    .map((heading) => heading.textContent);

describe("Story detail — the Investor reading", () => {
  it("reads the agreement axis first and single-source reporting last", async () => {
    renderStoryWithAnalysis(investorAnalysis);

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));
    await screen.findByText(investorAnalysis.claims[0].text);

    // The claims arrive in the order the model wrote them; the reading is ours.
    expect(groupHeadings()).toEqual([
      "Where the reporting agrees",
      "Where it disagrees",
      "Investor implication",
      "Reported by one outlet only",
    ]);
  });

  it("shows both sides of a disagreement, each with its Publisher and a citation to open", async () => {
    renderStoryWithAnalysis(investorAnalysis);

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));
    const claim = (await screen.findByText(investorAnalysis.claims[2].text)).closest("li")!;

    // The model names the proposition each side supports or contradicts; Publishers
    // are evidence within those positions, not positions of their own.
    expect(within(claim).getByText("Supports")).toBeInTheDocument();
    expect(within(claim).getByText("Contradicts")).toBeInTheDocument();
    expect(within(claim).getByText("Meridian Wire")).toBeInTheDocument();
    expect(within(claim).getByText("Harbour Ledger")).toBeInTheDocument();
    expect(within(claim).getByRole("link", { name: /A1 · Pilot line targets 2027 output/ })).toHaveAttribute(
      "href",
      "/articles/a1",
    );
    expect(within(claim).getByRole("link", { name: /A2 · Subsidy timing still unresolved/ })).toHaveAttribute(
      "href",
      "/articles/a2",
    );
  });

  it("counts an agreement in newsrooms, and says why the count means that", async () => {
    renderStoryWithAnalysis(investorAnalysis);

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));
    const agreed = (await screen.findByText(investorAnalysis.claims[0].text)).closest("li")!;

    expect(within(agreed).getByText("Cited to 2 of 2 publishers in the evidence")).toBeInTheDocument();
    // #54's collapse, stated: five mastheads running one wire report are one source,
    // which is the only thing that makes the count above worth reading.
    expect(screen.getByText(/counted once when this evidence was frozen/)).toBeInTheDocument();
  });

  it("says a disagreement is absent rather than leaving the axis out", async () => {
    // A contradiction the model wrote can be refused for citing one Publisher (#54)
    // and the run still completes, so silence here would read as outlets agreeing.
    renderStoryWithAnalysis({
      ...investorAnalysis,
      claims: investorAnalysis.claims.filter((claim) => claim.claimType !== "contradiction"),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));

    expect(await screen.findByText("Where it disagrees")).toBeInTheDocument();
    expect(screen.getByText(/No disagreement between these outlets is recorded/)).toBeInTheDocument();
  });

  it("leaves the Student's reading as it was", async () => {
    renderStoryWithAnalysis(analysis);

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));
    await screen.findByText(analysis.claims[0].text);

    expect(groupHeadings()).toEqual(["Where the reporting agrees", "Context"]);
    expect(screen.queryByText(/Cited to/)).not.toBeInTheDocument();
    expect(screen.queryByText(/counted once when this evidence was frozen/)).not.toBeInTheDocument();
  });

  // The surface's other two shared states (#30), on the Lens this ticket is about:
  // the wait while a model is answering, and a completed run holding nothing to show.
  // The error treatment is the failed-run test above.
  it("states the wait while the evidence is being read", async () => {
    let answer: (value: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      init?.method === "POST"
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : storyGet(input),
    );
    renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));

    expect(screen.getByRole("status")).toHaveTextContent(/Selecting evidence and writing claims/);
    answer(jsonResponse(investorAnalysis));
    expect(await screen.findByText(investorAnalysis.claims[0].text)).toBeInTheDocument();
  });

  it("states a completed analysis that holds nothing to show", async () => {
    renderStoryWithAnalysis({ ...investorAnalysis, claims: [] });

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));

    expect(await screen.findByText(/produced no claims that could be cited/)).toBeInTheDocument();
  });

  // The refusal an Investor meets most often: a Story that is one wire report under
  // several mastheads is one source, and the API says so rather than comparing it
  // with itself (#54).
  it("states a refusal to compare reporting that is one newsroom's", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      init?.method === "POST"
        ? jsonResponse(
            { error: "This Story needs independent reporting from at least two publishers to analyse" },
            422,
          )
        : storyGet(input),
    );
    renderWithProviders(<StoryDetail />, { route: "/stories/s1", path: "/stories/:id" });

    await userEvent.click(await screen.findByRole("button", { name: "Request analysis" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least two publishers/);
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

  it("says the body it is showing is cleared by Tessera's own classification, and links the original", async () => {
    renderArticle();

    expect(await screen.findByText(/Tessera classifies this Publisher's text as cleared to show/)).toBeInTheDocument();
    expect(screen.queryByText(/never redistributed or republished/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: `Read the original at ${publisher.domain}` }),
    ).toHaveAttribute("href", article.url);
  });

  it("says the text is withheld when Tessera holds none to show", async () => {
    renderArticle({ analysisText: null, analysisTextMode: "licensed_full_text" });

    expect(await screen.findByText(/held for analysis only/)).toBeInTheDocument();
    expect(screen.getByText("Licensed full text")).toBeInTheDocument();
    // The rule behind the withholding, not just its effect: a reader who sees no
    // body is told whose decision that was.
    expect(screen.getByText(/does not classify this Publisher's text as cleared to show/)).toBeInTheDocument();
  });

  // #79: the rung Extraction produces is served now that a Publisher defaults to
  // `licensed` (ADR-0032), and no API ever served it — the old label said one did.
  it("names an extracted body as extracted rather than as API content", async () => {
    renderArticle({ analysisTextMode: "api_content" });

    expect(await screen.findByText("Extracted text")).toBeInTheDocument();
    expect(screen.queryByText(/API content/)).not.toBeInTheDocument();
    expect(screen.getByText(/read from this Publisher's own page/)).toBeInTheDocument();
  });

  it("states when an Article has metadata but no analysable text", async () => {
    renderArticle({ analysisText: null, analysisTextMode: "metadata_only" });

    expect(await screen.findByText("Metadata only")).toBeInTheDocument();
    expect(screen.getByText(/No analysable article text is available/)).toBeInTheDocument();
    expect(screen.getByText(/Tessera holds the title and source metadata/)).toBeInTheDocument();
    expect(screen.getByText(/No article body is held/)).toBeInTheDocument();
    expect(screen.queryByText(/held for analysis only/)).not.toBeInTheDocument();
  });

  it("shows a mode it does not describe rather than throwing on it", async () => {
    // The union is the backend's, and it can grow: a mode this page has no words
    // for is still a fact about the record, so it appears instead of blanking it.
    renderArticle({ analysisTextMode: "syndicated_wire" as ArticleRecord["analysisTextMode"] });

    expect(await screen.findByText("syndicated_wire")).toBeInTheDocument();
  });

  // #85 / ADR-0035. The whole justification for showing a leaning is that it is
  // somebody else's published claim, so the credit is not decoration on it — it is
  // the thing that makes it showable. These two tests are what stops a later
  // restyle from separating them.
  it("shows a Publisher's leaning in the rater's own words, with the rater named", async () => {
    renderArticle({ publisherLeaning: allSidesRating });

    expect(await screen.findByText("Lean Left")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AllSides media bias ratings" })).toHaveAttribute(
      "href",
      allSidesRating.source.url,
    );
    expect(screen.getByText(/rates no publisher itself/)).toBeInTheDocument();
  });

  it("carries the rating's licence wherever the rating is", async () => {
    renderArticle({ publisherLeaning: allSidesRating });

    expect(await screen.findByText(/AllSides Media Bias Ratings/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CC BY-NC 4.0" })).toHaveAttribute(
      "href",
      allSidesRating.source.licenceUrl,
    );
  });

  it("states an unrated Publisher as unrated, and claims no licence it is not using", async () => {
    renderArticle();

    // The honest empty state: no rating exists, so none is implied — and with no
    // rating on the page there is nothing to attribute either.
    expect(await screen.findByText("No published rating")).toBeInTheDocument();
    expect(screen.getByText(/reproduces ratings rather than making them/)).toBeInTheDocument();
    expect(screen.queryByText(/CC BY-NC/)).not.toBeInTheDocument();
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
  // The Foundation's Brief: assembled by hand, freezing no generation (#55).
  generationRunId: null,
  analysis: null,
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

  // #55: a Brief that froze a generation renders the analysis itself, not a note
  // about one — the same register Story detail uses, from the run the Brief pinned.
  it("renders the frozen claims and their citations when it holds an analysis", async () => {
    renderBrief({ generationRunId: analysis.id, analysis });

    expect(await screen.findByText(analysis.claims[0].text)).toBeInTheDocument();
    expect(screen.getByText("Where the reporting agrees")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /A2 · Harbour Ledger/ })).toHaveAttribute("href", "/articles/a2");
    // And says what makes it worth owning: it stays as it is while the Story moves on.
    expect(screen.getByText(/keeps what it froze/)).toBeInTheDocument();
  });

  // #56: the reading follows the analysis, not the reader — a saved investor analysis
  // is read as one here, which is the whole reason the register keys off `lens`.
  it("keeps the Investor reading of an analysis saved under that Lens", async () => {
    renderBrief({ generationRunId: investorAnalysis.id, analysis: investorAnalysis });

    const claim = (await screen.findByText(investorAnalysis.claims[2].text)).closest("li")!;
    expect(within(claim).getByText("Harbour Ledger")).toBeInTheDocument();
    expect(within(claim).getByRole("link", { name: /A1 · Pilot line targets 2027 output/ })).toHaveAttribute(
      "href",
      "/articles/a1",
    );
    expect(screen.getByText("Cited to 2 of 2 publishers in the evidence")).toBeInTheDocument();
  });

  it("says nothing about an analysis when the Brief was assembled by hand", async () => {
    renderBrief();

    expect(await screen.findByRole("heading", { level: 1, name: brief.title })).toBeInTheDocument();
    expect(screen.queryByText("Saved analysis")).not.toBeInTheDocument();
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
