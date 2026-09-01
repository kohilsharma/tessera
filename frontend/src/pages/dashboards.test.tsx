import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminDashboard from "./AdminDashboard";
import InvestorDashboard from "./InvestorDashboard";
import RoleDashboard from "./RoleDashboard";
import StudentDashboard from "./StudentDashboard";
import { jsonResponse, listEnvelope, renderWithProviders } from "../test/renderWithProviders";

// The dashboards' first test file. jsdom does no layout and no cascade, so what
// the Bureau rollout (#36) did to these pages is a browser check, not a test —
// what is testable is the content contract the registers now carry: the rows
// each role's register lists, and the refusal a role that isn't yours gets.

describe("Student dashboard", () => {
  it("registers each study collection as a row opening its Brief", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        role: "student",
        studyCollections: [{ id: "b1", title: "Grid resilience", category: "technology" }],
      }),
    );

    renderWithProviders(<StudentDashboard />);

    const row = await screen.findByRole("listitem");
    expect(within(row).getByRole("link", { name: "Grid resilience" })).toHaveAttribute("href", "/briefs/b1");
    expect(within(row).getByText("technology")).toBeInTheDocument();
  });

  it("offers a way to start one when there are no collections", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ role: "student", studyCollections: [] }));

    renderWithProviders(<StudentDashboard />);

    expect(await screen.findByText(/No study collections yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start one" })).toHaveAttribute("href", "/briefs/new");
  });
});

describe("Investor dashboard", () => {
  const investorPayload = (overrides: Record<string, unknown> = {}) => ({
    role: "investor",
    sectors: [
      { category: "business", storyCount: 3, articleCount: 12 },
      { category: "health", storyCount: 1, articleCount: 2 },
    ],
    comparableStories: [],
    ...overrides,
  });

  it("lists each sector with both of its coverage counts", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(investorPayload()));

    renderWithProviders(<InvestorDashboard />);

    const [business, health] = await screen.findAllByRole("listitem");
    expect(within(business).getByRole("link", { name: "business" })).toHaveAttribute(
      "href",
      "/stories?category=business",
    );
    expect(within(business).getByText("12")).toBeInTheDocument();
    expect(within(health).getByText("2")).toBeInTheDocument();
  });

  // #56: the route into the Investor Lens. A row here is a Story the analysis
  // endpoint will actually write about, so it opens the record that carries the
  // consensus/contradiction reading.
  it("routes into the comparable Stories, stating how many Publishers each holds", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        investorPayload({
          comparableStories: [
            {
              id: "s1",
              title: "Interconnector timetable slips",
              category: "business",
              publisherCount: 3,
              lastSeenAt: "2026-08-31T08:00:00.000Z",
            },
          ],
        }),
      ),
    );

    renderWithProviders(<InvestorDashboard />);

    const row = await screen.findByRole("link", { name: "Interconnector timetable slips" });
    expect(row).toHaveAttribute("href", "/stories/s1");
    const entry = row.closest("li")!;
    expect(within(entry).getByText("3")).toBeInTheDocument();
    // No article count: the eligible members behind that 3 are a subset of the accepted
    // members /stories counts, and one word for two facts would be the defect.
    expect(within(entry).queryByText("Articles")).not.toBeInTheDocument();
  });

  it("says why there is nothing to compare rather than showing an empty register", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(investorPayload()));

    renderWithProviders(<InvestorDashboard />);

    expect(await screen.findByText(/nothing to compare/)).toBeInTheDocument();
  });
});

describe("Admin dashboard", () => {
  const adminPayload = (overrides: Record<string, unknown> = {}) => ({
    role: "admin",
    userCounts: { student: 4, investor: 2, admin: 1 },
    connectors: [
      {
        id: "c1",
        name: "GDELT GKG",
        kind: "gdelt_gkg",
        endpoint: "http://data.gdeltproject.org/gdeltv2/lastupdate.txt",
        enabled: true,
      },
    ],
    ingestionRuns: [],
    clusteringRuns: [],
    promptClaimCountRange: { min: 2, max: 8 },
    promptTemplates: [
      {
        id: "t1",
        version: "2026-09-03",
        params: {
          tone: "",
          claimCount: { min: 3, max: 6 },
          lensEmphasis: "",
          surfacedClaimTypes: ["consensus", "source_specific", "contradiction"],
        },
        isCurrent: true,
        createdAt: "2026-08-29T09:00:00.000Z",
      },
    ],
    publishers: [
      { id: "p1", name: "The Ledger", domain: "ledger.example", termsClass: "internal_only", articleCount: 7 },
    ],
    ...overrides,
  });

  const pendingAssignment = (overrides: Record<string, unknown> = {}) => ({
    id: "a1",
    title: "Grid operator revises connection timetable",
    url: "https://ledger.example/timetable",
    publishedAt: "2026-08-31T08:00:00.000Z",
    analysisTextMode: "feed_excerpt",
    publisher: { id: "p1", name: "The Ledger", domain: "ledger.example" },
    score: 0.81,
    proposedStory: { id: "s1", slug: "grid-interconnector", title: "Grid interconnector delayed", category: "business" },
    ...overrides,
  });

  const storySummary = (id: string, title: string) => ({
    id,
    slug: title.toLowerCase().replace(/\W+/g, "-"),
    title,
    summary: null,
    category: "business",
    firstSeenAt: "2026-08-30T09:00:00.000Z",
    lastSeenAt: "2026-08-31T09:00:00.000Z",
    articleCount: 3,
  });

  // Three requests feed this console since #52 — the payload, the review queue, and
  // the merge picker's Stories — so the mock answers by URL and method rather than by
  // call order, which is not something any of these tests mean to assert. `command`
  // is what a mutation gets back; `pending` is null to leave the queue's own request
  // hanging.
  function mockConsole({
    payload = adminPayload(),
    pending = [] as Record<string, unknown>[] | null,
    stories = [storySummary("s1", "Grid interconnector delayed"), storySummary("s2", "Interconnector timetable slips")],
    command = jsonResponse({ status: "accepted" }, 202),
  }: {
    payload?: unknown;
    pending?: Record<string, unknown>[] | null;
    stories?: Record<string, unknown>[];
    command?: Response;
  } = {}) {
    vi.mocked(fetch).mockImplementation((input, init) => {
      const method = (init as RequestInit | undefined)?.method;
      if (method && method !== "GET") return Promise.resolve(command);
      if (String(input).startsWith("/api/v1/clustering/pending")) {
        return pending === null
          ? new Promise<Response>(() => {})
          : Promise.resolve(jsonResponse(listEnvelope(pending)));
      }
      if (String(input).startsWith("/api/v1/stories")) return Promise.resolve(jsonResponse(listEnvelope(stories)));
      return Promise.resolve(jsonResponse(payload));
    });
  }

  // The fetch call a test is asserting about, found by URL for the same reason.
  const callTo = (url: string) => vi.mocked(fetch).mock.calls.find(([input]) => input === url);

  const ingestionRun = (overrides: Record<string, unknown> = {}) => ({
    id: "r1",
    connectorId: "c1",
    connectorName: "GDELT GKG",
    status: "succeeded",
    startedAt: "2026-08-30T10:00:00.000Z",
    completedAt: "2026-08-30T10:00:02.000Z",
    discovered: 6,
    inserted: 2,
    enriched: 3,
    duplicate: 1,
    rejectedByPolicy: 0,
    failed: 0,
    errorSummary: null,
    ...overrides,
  });

  it("shows the operator registers under their own headings", async () => {
    mockConsole();

    renderWithProviders(<AdminDashboard />);

    const accounts = await screen.findByRole("region", { name: "Accounts" });
    expect(within(accounts).getByText("4")).toBeInTheDocument();

    const connectors = screen.getByRole("region", { name: "Ingestion connectors" });
    expect(within(connectors).getByText("GDELT GKG")).toBeInTheDocument();
    expect(within(connectors).getByText("Enabled")).toBeInTheDocument();

    const publishers = screen.getByRole("region", { name: "Publishers" });
    expect(within(publishers).getByText("ledger.example")).toBeInTheDocument();
    expect(within(publishers).getByText("7")).toBeInTheDocument();
    // Story 20: the Terms Class sits beside the article count, so an operator can
    // see which sources are cleared to serve text (#40).
    expect(within(publishers).getByText("Internal only")).toBeInTheDocument();
  });

  // #39: the ingestion panel across the four shared UI states. Loading and error
  // are DashboardShell's, because the run history arrives in the same payload as
  // the rest of the console — there is no state in which the panel is fetching
  // and its neighbours are not.
  it("states that ingestion is loading before the payload arrives", () => {
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => {}));

    renderWithProviders(<AdminDashboard />);

    expect(screen.getByRole("status")).toHaveTextContent(/Loading your dashboard/);
  });

  it("states an error when the console cannot be loaded", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "Database unreachable" }, 500));

    renderWithProviders(<AdminDashboard />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Database unreachable");
  });

  it("distinguishes 'nothing has run yet' from a broken panel", async () => {
    mockConsole();

    renderWithProviders(<AdminDashboard />);

    const runs = await screen.findByRole("region", { name: "Ingestion runs" });
    expect(within(runs).getByText(/No connector has run yet/)).toBeInTheDocument();
  });

  it("registers each IngestionRun with its counters, in the order the API returns", async () => {
    mockConsole({
      payload: adminPayload({
        ingestionRuns: [
          ingestionRun(),
          ingestionRun({
            id: "r0",
            status: "failed",
            discovered: 0,
            inserted: 0,
            enriched: 0,
            duplicate: 0,
            errorSummary: "getaddrinfo ENOTFOUND feed.invalid",
          }),
        ],
      }),
    });

    renderWithProviders(<AdminDashboard />);

    const runs = await screen.findByRole("region", { name: "Ingestion runs" });
    const [newest, older] = within(runs).getAllByRole("listitem");
    expect(within(newest).getByText("Succeeded")).toBeInTheDocument();
    // Discovered 6 = inserted 2 + enriched 3 + duplicate 1: what an operator
    // reads a run for. #44: overlap between connectors is its own outcome here,
    // reported as neither an insert nor a duplicate.
    expect(within(newest).getByText("Discovered").closest("div")).toHaveTextContent("6");
    expect(within(newest).getByText("Inserted").closest("div")).toHaveTextContent("2");
    expect(within(newest).getByText("Enriched").closest("div")).toHaveTextContent("3");
    expect(within(newest).getByText("Duplicate").closest("div")).toHaveTextContent("1");
    // By the Status cell, not by the word: "Failed" is also a counter's term, and
    // a run that failed is not the same fact as a run with failed items.
    expect(within(older).getByText("Status").closest("div")).toHaveTextContent("Failed");
    // Story 10: a failed run is diagnosable here, not only in the server log.
    expect(within(older).getByText(/ENOTFOUND feed.invalid/)).toBeInTheDocument();
  });

  it("queues a connector run and says so, rather than claiming it ran", async () => {
    // #42: the endpoint acknowledges an enqueue; the run itself is the worker's.
    mockConsole({ command: jsonResponse({ connectorId: "c1", status: "accepted" }, 202) });

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Run" }));

    expect(callTo("/api/v1/ingestion/connectors/c1/run")?.[1]).toMatchObject({ method: "POST" });
    // The register states the queued run. Without it, a press against a stopped
    // worker — which is most of the time — is indistinguishable from a button
    // that does nothing.
    expect(await screen.findByRole("status")).toHaveTextContent("Run queued");
    // And the ledger stays honest: no run has happened, so it is still empty.
    const runs = screen.getByRole("region", { name: "Ingestion runs" });
    expect(within(runs).getByText(/No connector has run yet/)).toBeInTheDocument();
  });

  it("offers no Run for a disabled connector, and enables it in one press", async () => {
    const paused = {
      id: "c1",
      name: "Paused feed",
      kind: "rss",
      endpoint: "https://paused.example/feed.xml",
      enabled: false,
    };
    // The one test whose console *changes*: the PATCH is what enables the
    // connector, so the payload served afterwards has to reflect it.
    let connectors: Record<string, unknown>[] = [paused];
    vi.mocked(fetch).mockImplementation((input, init) => {
      const method = (init as RequestInit | undefined)?.method;
      if (method === "PATCH") {
        connectors = [{ ...paused, enabled: true }];
        return Promise.resolve(jsonResponse({ ...paused, enabled: true }));
      }
      if (String(input).startsWith("/api/v1/clustering/pending")) {
        return Promise.resolve(jsonResponse(listEnvelope([])));
      }
      if (String(input).startsWith("/api/v1/stories")) return Promise.resolve(jsonResponse(listEnvelope([])));
      return Promise.resolve(jsonResponse(adminPayload({ connectors })));
    });

    renderWithProviders(<AdminDashboard />);

    expect(await screen.findByRole("button", { name: "Run" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Enable" }));

    expect(callTo("/api/v1/ingestion/connectors/c1")?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });
    // The refetched console shows the connector live, and its Run offered.
    expect(await screen.findByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  // #49: the clustering register, in the same three shapes as ingestion's — empty
  // until a pass has run, a ledger once one has, and a queued acknowledgement when
  // an operator presses the command.
  it("distinguishes 'clustering has not run yet' from a broken register", async () => {
    mockConsole();

    renderWithProviders(<AdminDashboard />);

    const runs = await screen.findByRole("region", { name: "Clustering runs" });
    expect(within(runs).getByText(/Clustering has not run yet/)).toBeInTheDocument();
  });

  it("registers a ClusteringRun with the counts an operator reads it for", async () => {
    mockConsole({
      payload: adminPayload({
        clusteringRuns: [
          {
            id: "k1",
            status: "succeeded",
            startedAt: "2026-08-31T10:00:00.000Z",
            completedAt: "2026-08-31T10:00:20.000Z",
            embedded: 12,
            considered: 12,
            assigned: 4,
            heldForReview: 1,
            seeded: 5,
            unclustered: 2,
            storiesCreated: 3,
            errorSummary: null,
          },
        ],
      }),
    });

    renderWithProviders(<AdminDashboard />);

    const runs = await screen.findByRole("region", { name: "Clustering runs" });
    const row = within(runs).getByRole("listitem");
    // considered 12 = assigned 4 + held 1 + seeded 5 + unclustered 2, which is the
    // ledger ADR-0026 makes the run answerable by — four outcomes since #50 added
    // the review band.
    expect(within(row).getByText("Considered").closest("div")).toHaveTextContent("12");
    expect(within(row).getByText("Assigned").closest("div")).toHaveTextContent("4");
    expect(within(row).getByText("Held").closest("div")).toHaveTextContent("1");
    expect(within(row).getByText("Seeded").closest("div")).toHaveTextContent("5");
    expect(within(row).getByText("Unclustered").closest("div")).toHaveTextContent("2");
    expect(within(row).getByText("New Stories").closest("div")).toHaveTextContent("3");
    expect(within(row).getByText("Embedded").closest("div")).toHaveTextContent("12");
  });

  it("queues the clustering pass and says so, rather than claiming it clustered", async () => {
    mockConsole({ command: jsonResponse({ status: "accepted" }, 202) });

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Run clustering" }));

    expect(callTo("/api/v1/clustering/runs")?.[1]).toMatchObject({ method: "POST" });
    expect(await screen.findByRole("status")).toHaveTextContent("Clustering queued");
    // No run has happened, so the ledger is still empty rather than optimistic.
    const runs = screen.getByRole("region", { name: "Clustering runs" });
    expect(within(runs).getByText(/Clustering has not run yet/)).toBeInTheDocument();
  });

  it("states a refused command in the connector register rather than blanking the console", async () => {
    mockConsole({ command: jsonResponse({ error: "Connector is disabled" }, 409) });

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Run" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Connector is disabled");
    // The console is still there: a refused command is not a failed page.
    expect(screen.getByRole("region", { name: "Publishers" })).toBeInTheDocument();
  });
  // #50: the review queue. Its own request, so unlike every other register here it
  // owns all four of the shared UI states — which is the point: an operator has to
  // be able to tell "nothing is waiting" from "the queue would not load".
  it("states that the review queue is loading while the rest of the console is not", async () => {
    mockConsole({ pending: null });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Clustering review" });
    expect(within(review).getByRole("status")).toHaveTextContent(/Loading the review queue/);
    // The console around it loaded fine, which is exactly why this state is the
    // register's own rather than the page's.
    expect(screen.getByRole("region", { name: "Publishers" })).toBeInTheDocument();
  });

  it("offers a retry when the review queue alone cannot be loaded", async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input).startsWith("/api/v1/clustering/pending")) {
        return Promise.resolve(jsonResponse({ error: "Review queue unavailable" }, 500));
      }
      if (String(input).startsWith("/api/v1/stories")) return Promise.resolve(jsonResponse(listEnvelope([])));
      return Promise.resolve(jsonResponse(adminPayload()));
    });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Clustering review" });
    expect(within(review).getByRole("alert")).toHaveTextContent("Review queue unavailable");
    expect(within(review).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("distinguishes an empty review queue from a broken one", async () => {
    mockConsole();

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Clustering review" });
    expect(within(review).getByText(/Nothing is waiting on a decision/)).toBeInTheDocument();
  });

  it("registers each proposal with its score and the Story it would join", async () => {
    mockConsole({ pending: [pendingAssignment()] });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Clustering review" });
    const row = within(review).getByRole("listitem");
    expect(within(row).getByText("Grid operator revises connection timetable")).toBeInTheDocument();
    expect(within(row).getByText("Score").closest("div")).toHaveTextContent("0.81");
    // The proposed Story opens, so a reviewer can read what the proposal claims this
    // reporting belongs to. The Article does not: it has no record page while it is
    // pending, which is the whole reason this queue exists.
    expect(within(row).getByRole("link", { name: "Grid interconnector delayed" })).toHaveAttribute(
      "href",
      "/stories/s1",
    );
    expect(within(row).queryByRole("link", { name: /Grid operator revises/ })).toBeNull();
  });

  it.each([
    ["Accept", "accept"],
    ["Reject", "reject"],
  ])("sends the %s decision for the proposal it sits beside", async (label, decision) => {
    mockConsole({
      pending: [pendingAssignment()],
      command: jsonResponse({ articleId: "a1", storyId: "s1", decision }),
    });

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: label }));

    expect(callTo("/api/v1/clustering/pending/a1")?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ decision }),
    });
  });

  it("states a refused decision in the review register rather than blanking the console", async () => {
    mockConsole({
      pending: [pendingAssignment()],
      command: jsonResponse({ error: "Pending assignment not found" }, 404),
    });

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));

    const review = await screen.findByRole("region", { name: "Clustering review" });
    expect(within(review).getByRole("alert")).toHaveTextContent("Pending assignment not found");
    expect(screen.getByRole("region", { name: "Publishers" })).toBeInTheDocument();
  });

  // #52: the merge, the one command here that is not an enqueue — so unlike the run
  // triggers it reports what it did, not what it queued.
  it("merges the pair an operator chooses, naming the survivor first", async () => {
    mockConsole({ command: jsonResponse({ survivorStoryId: "s1", mergedStoryId: "s2", movedArticles: 4 }) });

    renderWithProviders(<AdminDashboard />);

    const register = await screen.findByRole("region", { name: "Story merge" });
    await userEvent.selectOptions(within(register).getByLabelText(/Surviving Story/), "s1");
    await userEvent.selectOptions(within(register).getByLabelText(/Merged into it/), "s2");
    await userEvent.click(within(register).getByRole("button", { name: "Merge" }));

    expect(callTo("/api/v1/clustering/merges")?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ survivorStoryId: "s1", mergedStoryId: "s2" }),
    });
    // What it did, stated where it was fired: the Stories are one Story already, so
    // "queued" would be the wrong tense.
    expect(within(register).getByRole("status")).toHaveTextContent(/4 Articles moved/);
  });

  it("does not offer a merge until two different Stories are named", async () => {
    mockConsole();

    renderWithProviders(<AdminDashboard />);

    const register = await screen.findByRole("region", { name: "Story merge" });
    const command = within(register).getByRole("button", { name: "Merge" });
    expect(command).toBeDisabled();

    // The same Story on both sides is the one pair the command must never send: it
    // would delete the Story it was asked to keep.
    await userEvent.selectOptions(within(register).getByLabelText(/Surviving Story/), "s1");
    await userEvent.selectOptions(within(register).getByLabelText(/Merged into it/), "s1");
    expect(command).toBeDisabled();

    await userEvent.selectOptions(within(register).getByLabelText(/Merged into it/), "s2");
    expect(command).toBeEnabled();
  });

  it("states a refused merge in its own register, and says when there is no pair to merge", async () => {
    mockConsole({ command: jsonResponse({ error: "A Story in the Curated Corpus cannot be merged" }, 422) });

    const { unmount } = renderWithProviders(<AdminDashboard />);

    const register = await screen.findByRole("region", { name: "Story merge" });
    await userEvent.selectOptions(within(register).getByLabelText(/Surviving Story/), "s1");
    await userEvent.selectOptions(within(register).getByLabelText(/Merged into it/), "s2");
    await userEvent.click(within(register).getByRole("button", { name: "Merge" }));

    expect(within(register).getByRole("alert")).toHaveTextContent("Curated Corpus");
    expect(screen.getByRole("region", { name: "Publishers" })).toBeInTheDocument();
    unmount();

    // And the empty state: one Story is not a pair, which is a different thing from
    // a picker that would not load.
    mockConsole({ stories: [storySummary("s1", "Grid interconnector delayed")] });
    renderWithProviders(<AdminDashboard />);

    const alone = await screen.findByRole("region", { name: "Story merge" });
    expect(within(alone).getByText(/Fewer than two Stories/)).toBeInTheDocument();
  });

  // #57, ADR-0021: an Admin shapes what every reader gets by writing a version and
  // making it current. What the register must not offer is the citation check, so the
  // form's fields are the whole of the tuning surface.
  it("creates a prompt version from the tuning form, and says it is not live yet", async () => {
    mockConsole({
      command: jsonResponse({ id: "t2", version: "2026-10-01-plainer", isCurrent: false }, 201),
    });

    renderWithProviders(<AdminDashboard />);

    const register = await screen.findByRole("region", { name: "Prompt versions" });
    expect(within(register).getByLabelText(/Fewest claims/)).toHaveAttribute("min", "2");
    expect(within(register).getByLabelText(/Most claims/)).toHaveAttribute("max", "8");
    await userEvent.type(within(register).getByLabelText(/Version label/), "2026-10-01-plainer");
    await userEvent.type(within(register).getByLabelText(/Tone/), "plain, unhurried sentences");
    await userEvent.click(within(register).getByRole("checkbox", { name: "contradiction" }));
    await userEvent.click(within(register).getByRole("button", { name: "Create version" }));

    expect(callTo("/api/v1/prompt-templates")?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        version: "2026-10-01-plainer",
        params: {
          tone: "plain, unhurried sentences",
          lensEmphasis: "",
          claimCount: { min: 3, max: 6 },
          surfacedClaimTypes: ["consensus", "source_specific"],
        },
      }),
    });
    // Created is not live: an operator has to activate it, and the note says so
    // rather than implying every reader is already being served under it.
    expect(within(register).getByRole("status")).toHaveTextContent(/Make it current to serve it/);
  });

  it("makes a retained version current and states exact-version reuse", async () => {
    mockConsole({
      payload: adminPayload({
        promptTemplates: [
          {
            id: "t2",
            version: "2026-10-01-plainer",
            params: {
              tone: "plain, unhurried sentences",
              claimCount: { min: 2, max: 4 },
              lensEmphasis: "Explain the terms first.",
              surfacedClaimTypes: ["consensus", "source_specific"],
            },
            isCurrent: false,
            createdAt: "2026-09-04T09:00:00.000Z",
          },
          ...adminPayload().promptTemplates,
        ],
      }),
      command: jsonResponse({ id: "t2", version: "2026-10-01-plainer", isCurrent: true }),
    });

    renderWithProviders(<AdminDashboard />);

    const register = await screen.findByRole("region", { name: "Prompt versions" });
    expect(within(register).getByText(/2–4 claims · consensus, source_specific/)).toBeInTheDocument();
    expect(within(register).getByText("Current")).toBeInTheDocument();
    const activate = within(register).getByRole("button", { name: "Make current" });

    await userEvent.click(activate);

    expect(callTo("/api/v1/prompt-templates/t2")?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ isCurrent: true }),
    });
    expect(within(register).getByRole("status")).toHaveTextContent(/under this exact version may be reused/);
  });

  it("deactivates the current prompt version", async () => {
    mockConsole({
      command: jsonResponse({ id: "t1", version: "generation-v2", isCurrent: false }),
    });

    renderWithProviders(<AdminDashboard />);

    const register = await screen.findByRole("region", { name: "Prompt versions" });
    await userEvent.click(await within(register).findByRole("button", { name: "Deactivate" }));

    expect(callTo("/api/v1/prompt-templates/t1")?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ isCurrent: false }),
    });
    expect(within(register).getByRole("status")).toHaveTextContent(/generation uses the shipped prompt/);
  });

  it("states a refused prompt version where it was fired", async () => {
    mockConsole({
      command: jsonResponse(
        { error: "surfacedClaimTypes must include consensus: an analysis is refused below the prompt without one" },
        422,
      ),
    });

    renderWithProviders(<AdminDashboard />);

    const register = await screen.findByRole("region", { name: "Prompt versions" });
    await userEvent.type(within(register).getByLabelText(/Version label/), "2026-10-02-broken");
    await userEvent.click(within(register).getByRole("checkbox", { name: "consensus" }));
    await userEvent.click(within(register).getByRole("button", { name: "Create version" }));

    // The refusal names the invariant it protects rather than the field it rejected:
    // tuning that cannot produce a publishable analysis is refused above the prompt,
    // not silently accepted and failed below it.
    expect(within(register).getByRole("alert")).toHaveTextContent(/must include consensus/);
  });
});

describe("Role dashboard routing", () => {
  // Both article paths: the refusal names the caller's role, and "a investor"
  // would be the first thing a reader notices about the message.
  it.each([
    ["student", "Your account is a student, so that dashboard is not yours."],
    ["investor", "Your account is an investor, so that dashboard is not yours."],
  ])("refuses a dashboard that is not the caller's, in the error treatment (%s)", async (role, message) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "u1", email: `${role}@tessera.local`, role }));

    renderWithProviders(<RoleDashboard />, { route: "/dashboard/admin", path: "/dashboard/:role" });

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});
