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
        flashcards: { dueCount: 3, totalCount: 8, nextDueAt: null },
      }),
    );

    renderWithProviders(<StudentDashboard />);

    const collectionLink = await screen.findByRole("link", { name: "Grid resilience" });
    const row = collectionLink.closest("li")!;
    expect(collectionLink).toHaveAttribute("href", "/briefs/b1");
    expect(within(row).getByText("technology")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review 3 flashcards" })).toHaveAttribute("href", "/study");
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("offers a way to start one when there are no collections", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        role: "student",
        studyCollections: [],
        flashcards: { dueCount: 0, totalCount: 0, nextDueAt: null },
      }),
    );

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
    entityResolutionRuns: [],
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
      // #85: one rated and one not, because both are ordinary states of this
      // register — AllSides rates nationally prominent outlets, so an invented
      // demo domain having no rating is the norm rather than missing data.
      { id: "p1", name: "The Ledger", domain: "ledger.example", termsClass: "internal_only", articleCount: 7, leaning: null },
      {
        id: "p2",
        name: "Fox News",
        domain: "foxnews.com",
        termsClass: "licensed",
        articleCount: 3,
        leaning: {
          rating: "right",
          label: "Right",
          band: "right",
          source: {
            name: "AllSides",
            attribution: "AllSides Media Bias Ratings™. AllSides Technologies, Inc. Retrieved September 2026.",
            url: "https://www.allsides.com/media-bias/media-bias-ratings",
            licence: "CC BY-NC 4.0",
            licenceUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
          },
        },
      },
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

  // #67: a candidate merge in the band beneath the automatic bar. Both sides carry the
  // reporting behind them, which is the whole of what the reviewer decides on — the
  // survivor is the more-reported side, fixed by the pass rather than chosen here.
  const mergeProposal = (overrides: Record<string, unknown> = {}) => ({
    id: "mp1",
    similarity: 0.78,
    kind: "organization",
    survivor: {
      id: "e1",
      kind: "organization",
      canonicalName: "Australian Associated Press",
      articleCount: 9,
      articles: [
        {
          id: "a2",
          title: "Wire service reports grid delay",
          url: "https://ledger.example/wire-grid",
          publishedAt: "2026-08-30T07:00:00.000Z",
          // Accepted into a Story, so this one has a record a reviewer can open.
          story: { id: "s1", slug: "grid-delay", title: "Grid delay" },
        },
      ],
    },
    merged: {
      id: "e2",
      kind: "organization",
      canonicalName: "Australian Associated",
      articleCount: 3,
      articles: [
        {
          id: "a3",
          title: "Truncated byline on interconnector filing",
          url: "https://ledger.example/byline",
          publishedAt: "2026-08-29T07:00:00.000Z",
          // Firehose reporting in no Story — the majority case the graph reads.
          story: null,
        },
      ],
    },
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

  // Four requests feed this console since #67 — the payload, the two review queues, and
  // the merge picker's Stories — so the mock answers by URL and method rather than by
  // call order, which is not something any of these tests mean to assert. `command`
  // is what a mutation gets back; `pending` and `proposals` are null to leave a queue's
  // own request hanging.
  function mockConsole({
    payload = adminPayload(),
    pending = [] as Record<string, unknown>[] | null,
    proposals = [] as Record<string, unknown>[] | null,
    stories = [storySummary("s1", "Grid interconnector delayed"), storySummary("s2", "Interconnector timetable slips")],
    command = jsonResponse({ status: "accepted" }, 202),
  }: {
    payload?: unknown;
    pending?: Record<string, unknown>[] | null;
    proposals?: Record<string, unknown>[] | null;
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
      if (String(input).startsWith("/api/v1/graph/merge-proposals")) {
        return proposals === null
          ? new Promise<Response>(() => {})
          : Promise.resolve(jsonResponse({ ...listEnvelope(proposals), retainedDays: 7 }));
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
    // #85: the second axis, and the one that is somebody else's judgement. Both
    // states read as statements — an unrated publisher says so rather than
    // leaving the operator to read a blank cell as a rating of zero.
    expect(within(publishers).getByText("Right")).toBeInTheDocument();
    expect(within(publishers).getByText("No published rating")).toBeInTheDocument();
    // The credit the ratings are licensed under, once for the register that shows
    // them: a rating and its attribution ship together or not at all (ADR-0035).
    expect(within(publishers).getByText(/AllSides Media Bias Ratings/)).toBeInTheDocument();
    expect(within(publishers).getByRole("link", { name: "CC BY-NC 4.0" })).toBeInTheDocument();
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
      if (String(input).startsWith("/api/v1/graph/merge-proposals")) {
        return Promise.resolve(jsonResponse({ ...listEnvelope([]), retainedDays: 7 }));
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

  it("registers an EntityResolutionRun with the counters the pass is answerable by", async () => {
    mockConsole({
      payload: adminPayload({
        entityResolutionRuns: [
          {
            id: "g1",
            status: "succeeded",
            startedAt: "2026-08-31T10:20:00.000Z",
            completedAt: "2026-08-31T10:20:30.000Z",
            annotationsRead: 19442,
            articlesRead: 968,
            considered: 40,
            promoted: 12,
            belowFloor: 28,
            demoted: 3,
            merged: 2,
            proposed: 5,
            edgesBuilt: 57,
            errorSummary: null,
          },
        ],
      }),
    });

    renderWithProviders(<AdminDashboard />);

    const runs = await screen.findByRole("region", { name: "Entity resolution runs" });
    const row = within(runs).getByRole("listitem");
    // considered 40 = promoted 12 + below floor 28: the floor is the whole decision this
    // pass makes, so the two outcomes summing to the input is what the register states.
    expect(within(row).getByText("Considered").closest("div")).toHaveTextContent("40");
    expect(within(row).getByText("Promoted").closest("div")).toHaveTextContent("12");
    expect(within(row).getByText("Below floor").closest("div")).toHaveTextContent("28");
    // Read, demoted and built sit outside that sum, each answering a different question:
    // what the pass looked at, what left the working set, and how big the graph now is.
    // 19,442 and not the 66,229 a measured window stages: a Theme is never read here.
    expect(within(row).getByText("Annotations").closest("div")).toHaveTextContent("19442");
    expect(within(row).getByText("Articles").closest("div")).toHaveTextContent("968");
    expect(within(row).getByText("Demoted").closest("div")).toHaveTextContent("3");
    expect(within(row).getByText("Edges").closest("div")).toHaveTextContent("57");
    // #67 counts pairs, not names, so these two are outside the sum for a second reason:
    // both names of a merged pair were promoted by this same pass before it folded them.
    expect(within(row).getByText("Merged").closest("div")).toHaveTextContent("2");
    expect(within(row).getByText("Proposed").closest("div")).toHaveTextContent("5");
  });

  it("queues the resolution pass and says so, rather than claiming it resolved", async () => {
    mockConsole({ command: jsonResponse({ status: "accepted" }, 202) });

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Run resolution" }));

    expect(callTo("/api/v1/graph/resolution-runs")?.[1]).toMatchObject({ method: "POST" });
    expect(await screen.findByRole("status")).toHaveTextContent("Entity resolution queued");
    // The worker is what promotes and connects, so the ledger below is still empty.
    const runs = screen.getByRole("region", { name: "Entity resolution runs" });
    expect(within(runs).getByText(/Entity resolution has not run yet/)).toBeInTheDocument();
  });

  // #99: the register stopped being read-only. The form is the whole of what an
  // operator can now say about a connector, so what it sends is the contract.
  it("creates a connector from the register's own form", async () => {
    mockConsole({
      command: jsonResponse(
        { id: "c2", name: "Guardian world", kind: "rss", endpoint: "https://guardian.example/rss", feedProvidesFullText: true, enabled: true },
        201,
      ),
    });

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Add connector" }));
    const form = screen.getByRole("form", { name: "Create connector" });
    await userEvent.type(within(form).getByLabelText("Name"), "Guardian world");
    await userEvent.type(within(form).getByLabelText("Endpoint"), "https://guardian.example/rss");
    // The RSS-only policy field appears for the kind it belongs to and no other.
    await userEvent.click(within(form).getByLabelText(/Feed supplies full text/));
    await userEvent.click(within(form).getByRole("button", { name: "Create connector" }));

    const call = callTo("/api/v1/ingestion/connectors");
    expect(call?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
      name: "Guardian world",
      kind: "rss",
      endpoint: "https://guardian.example/rss",
      feedProvidesFullText: true,
    });
  });

  it("edits an existing connector through the same form, prefilled", async () => {
    mockConsole({
      command: jsonResponse({
        id: "c1",
        name: "GDELT GKG",
        kind: "gdelt_gkg",
        endpoint: "http://data.gdeltproject.org/gdeltv2/lastupdate.txt",
        feedProvidesFullText: null,
        enabled: true,
      }),
    });

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit connector" });
    // Editing starts from what the connector already is, not from an empty form.
    expect(within(form).getByLabelText("Name")).toHaveValue("GDELT GKG");
    // The feed policy belongs to RSS alone, so a GKG connector is not asked.
    expect(within(form).queryByLabelText(/Feed supplies full text/)).not.toBeInTheDocument();

    await userEvent.clear(within(form).getByLabelText("Endpoint"));
    await userEvent.type(within(form).getByLabelText("Endpoint"), "http://data.gdeltproject.org/gdeltv2/moved.txt");
    await userEvent.click(within(form).getByRole("button", { name: "Save connector" }));

    const call = callTo("/api/v1/ingestion/connectors/c1");
    expect(call?.[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
      endpoint: "http://data.gdeltproject.org/gdeltv2/moved.txt",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("GDELT GKG updated.");
  });

  // The ticket's own wording: deleting states what happens to the runs rather
  // than silently cascading. An operator who is not told history survives has to
  // guess, and the safe guess is to never delete anything.
  it("states what a deletion will keep before it happens, and what it kept after", async () => {
    mockConsole({
      command: jsonResponse({
        id: "c1",
        status: "deleted",
        runsRetained: 3,
        message: "Connector deleted; 3 ingestion runs retained.",
      }),
    });

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

    // Nothing is sent on opening the confirmation — the press asks, it does not do.
    const confirmation = await screen.findByRole("alertdialog");
    expect(callTo("/api/v1/ingestion/connectors/c1")).toBeUndefined();
    expect(within(confirmation).getByRole("heading")).toHaveTextContent("Delete GDELT GKG?");
    expect(confirmation).toHaveTextContent(/run history is kept/i);
    expect(confirmation).toHaveTextContent(/Articles it\s+discovered remain in the corpus/i);

    await userEvent.click(within(confirmation).getByRole("button", { name: "Delete connector" }));

    expect(callTo("/api/v1/ingestion/connectors/c1")?.[1]).toMatchObject({ method: "DELETE" });
    expect(await screen.findByRole("status")).toHaveTextContent("3 ingestion runs retained");
    expect(screen.getByText(/run history stays in the ledger below/i)).toBeInTheDocument();
  });

  it("deletes nothing when the operator backs out of the confirmation", async () => {
    mockConsole();

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const confirmation = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirmation).getByRole("button", { name: "Keep it" }));

    expect(callTo("/api/v1/ingestion/connectors/c1")).toBeUndefined();
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
      if (String(input).startsWith("/api/v1/graph/merge-proposals")) {
        return Promise.resolve(jsonResponse({ ...listEnvelope([]), retainedDays: 7 }));
      }
      if (String(input).startsWith("/api/v1/stories")) return Promise.resolve(jsonResponse(listEnvelope([])));
      return Promise.resolve(jsonResponse(adminPayload()));
    });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Clustering review" });
    expect(await within(review).findByRole("alert")).toHaveTextContent("Review queue unavailable");
    expect(within(review).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("distinguishes an empty review queue from a broken one", async () => {
    mockConsole();

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Clustering review" });
    expect(await within(review).findByText(/Nothing is waiting on a decision/)).toBeInTheDocument();
  });

  it("registers each proposal with its score and the Story it would join", async () => {
    mockConsole({ pending: [pendingAssignment()] });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Clustering review" });
    const row = await within(review).findByRole("listitem");
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

  // #67: the second review queue, and the same four states for the same reason — an
  // operator has to be able to tell "no candidate is waiting" from "the queue would not
  // load", and it fetches separately from the console around it.
  it("states that the merge queue is loading while the rest of the console is not", async () => {
    mockConsole({ proposals: null });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Entity merge review" });
    expect(within(review).getByRole("status")).toHaveTextContent(/Loading the candidate merges/);
    expect(screen.getByRole("region", { name: "Publishers" })).toBeInTheDocument();
  });

  it("offers a retry when the merge queue alone cannot be loaded", async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      if (String(input).startsWith("/api/v1/graph/merge-proposals")) {
        return Promise.resolve(jsonResponse({ error: "Merge queue unavailable" }, 500));
      }
      if (String(input).startsWith("/api/v1/clustering/pending")) {
        return Promise.resolve(jsonResponse(listEnvelope([])));
      }
      if (String(input).startsWith("/api/v1/stories")) return Promise.resolve(jsonResponse(listEnvelope([])));
      return Promise.resolve(jsonResponse(adminPayload()));
    });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Entity merge review" });
    expect(await within(review).findByRole("alert")).toHaveTextContent("Merge queue unavailable");
    expect(within(review).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("distinguishes an empty merge queue from a broken one", async () => {
    mockConsole();

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Entity merge review" });
    expect(await within(review).findByText(/No candidate merge is waiting on a decision/)).toBeInTheDocument();
  });

  it("registers a candidate merge with both names, their kind, and the reporting behind each", async () => {
    mockConsole({ proposals: [mergeProposal()] });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Entity merge review" });
    // Which name survives is the pass's decision, not the reviewer's, so the row states
    // the fold rather than offering an orientation to choose.
    expect(
      await within(review).findByText("Fold “Australian Associated” into “Australian Associated Press”"),
    ).toBeInTheDocument();
    expect(within(review).getByText("Similarity").closest("div")).toHaveTextContent("0.78");
    // One kind for the pair: same-kind by construction, and it is what tells two
    // identical strings apart when they are a person and a company.
    expect(within(review).getByText("Kind").closest("div")).toHaveTextContent("organization");
    // Each side labelled by the name its reporting belongs to — which stack is whose is
    // the decision, so the pair is never one undifferentiated run of links.
    expect(within(review).getByText("Kept · Australian Associated Press · 9 Articles")).toBeInTheDocument();
    expect(within(review).getByText("Folded in · Australian Associated · 3 Articles")).toBeInTheDocument();
    // Each sample opens where it can be read, which the endpoint's membership label
    // decides: an Article a Story accepted has a record, and `/articles/:id` 404s the rest
    // — which is most of a firehose-derived graph (ADR-0028), and opens at its Publisher.
    expect(within(review).getByRole("link", { name: "Wire service reports grid delay" })).toHaveAttribute(
      "href",
      "/articles/a2",
    );
    expect(within(review).getByRole("link", { name: /Truncated byline/ })).toHaveAttribute(
      "href",
      "https://ledger.example/byline",
    );
    expect(within(review).getByRole("link", { name: /Truncated byline/ })).toHaveAttribute("target", "_blank");
    // The price of AGENTS.md's exemption, paid on this surface as it is on the two reader
    // graph surfaces: a queue reading the firehose says which corpus it read.
    expect(within(review).getByText("Corpus").closest("div")).toHaveTextContent(
      "GDELT firehose, plus Tessera’s Curated Corpus",
    );
    expect(within(review).getByText("Retention window").closest("div")).toHaveTextContent("Rolling 7 days");
  });

  it.each([
    ["Accept", "accept"],
    ["Refuse", "refuse"],
  ])("sends the %s decision for the candidate merge it sits beside", async (label, decision) => {
    mockConsole({
      proposals: [mergeProposal()],
      command: jsonResponse({ proposalId: "mp1", decision, survivorEntityId: "e1", mergedEntityId: "e2" }),
    });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Entity merge review" });
    await userEvent.click(await within(review).findByRole("button", { name: label }));

    expect(callTo("/api/v1/graph/merge-proposals/mp1")?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ decision }),
    });
  });

  it("states a decision another operator already made in the merge register alone", async () => {
    mockConsole({
      proposals: [mergeProposal()],
      command: jsonResponse({ error: "Merge proposal not found" }, 404),
    });

    renderWithProviders(<AdminDashboard />);

    const review = await screen.findByRole("region", { name: "Entity merge review" });
    await userEvent.click(await within(review).findByRole("button", { name: "Refuse" }));

    expect(await within(review).findByRole("alert")).toHaveTextContent("Merge proposal not found");
    expect(screen.getByRole("region", { name: "Publishers" })).toBeInTheDocument();
  });

  // #52: the merge, the one command here that is not an enqueue — so unlike the run
  // triggers it reports what it did, not what it queued.
  it("merges the pair an operator chooses, naming the survivor first", async () => {
    mockConsole({ command: jsonResponse({ survivorStoryId: "s1", mergedStoryId: "s2", movedArticles: 4 }) });

    renderWithProviders(<AdminDashboard />);

    const register = await screen.findByRole("region", { name: "Story merge" });
    await userEvent.selectOptions(await within(register).findByLabelText(/Surviving Story/), "s1");
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
    const command = await within(register).findByRole("button", { name: "Merge" });
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
    await userEvent.selectOptions(await within(register).findByLabelText(/Surviving Story/), "s1");
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
    expect(await within(alone).findByText(/Fewer than two Stories/)).toBeInTheDocument();
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

  it("offers no way to leave the console with no current version", async () => {
    mockConsole();

    renderWithProviders(<AdminDashboard />);

    const register = await screen.findByRole("region", { name: "Prompt versions" });
    // The current version carries no command at all: it is superseded by activating
    // another (#57), and "nothing current" is a state the API refuses.
    expect(within(register).getByText("Current")).toBeInTheDocument();
    expect(within(register).queryByRole("button", { name: /Deactivate|Make current/ })).toBeNull();
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
