import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminDashboard from "./AdminDashboard";
import InvestorDashboard from "./InvestorDashboard";
import RoleDashboard from "./RoleDashboard";
import StudentDashboard from "./StudentDashboard";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

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
  it("lists each sector with both of its coverage counts", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        role: "investor",
        sectors: [
          { category: "business", storyCount: 3, articleCount: 12 },
          { category: "health", storyCount: 1, articleCount: 2 },
        ],
      }),
    );

    renderWithProviders(<InvestorDashboard />);

    const [business, health] = await screen.findAllByRole("listitem");
    expect(within(business).getByRole("link", { name: "business" })).toHaveAttribute(
      "href",
      "/stories?category=business",
    );
    expect(within(business).getByText("12")).toBeInTheDocument();
    expect(within(health).getByText("2")).toBeInTheDocument();
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
    publishers: [
      { id: "p1", name: "The Ledger", domain: "ledger.example", termsClass: "internal_only", articleCount: 7 },
    ],
    ...overrides,
  });

  const ingestionRun = (overrides: Record<string, unknown> = {}) => ({
    id: "r1",
    connectorId: "c1",
    connectorName: "GDELT GKG",
    status: "succeeded",
    startedAt: "2026-08-30T10:00:00.000Z",
    completedAt: "2026-08-30T10:00:02.000Z",
    discovered: 3,
    inserted: 2,
    enriched: 0,
    duplicate: 1,
    rejectedByPolicy: 0,
    failed: 0,
    errorSummary: null,
    ...overrides,
  });

  it("shows the operator registers under their own headings", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(adminPayload()));

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
    vi.mocked(fetch).mockResolvedValue(jsonResponse(adminPayload()));

    renderWithProviders(<AdminDashboard />);

    const runs = await screen.findByRole("region", { name: "Ingestion runs" });
    expect(within(runs).getByText(/No connector has run yet/)).toBeInTheDocument();
  });

  it("registers each IngestionRun with its counters, in the order the API returns", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        adminPayload({
          ingestionRuns: [
            ingestionRun(),
            ingestionRun({
              id: "r0",
              status: "failed",
              discovered: 0,
              inserted: 0,
              duplicate: 0,
              errorSummary: "getaddrinfo ENOTFOUND feed.invalid",
            }),
          ],
        }),
      ),
    );

    renderWithProviders(<AdminDashboard />);

    const runs = await screen.findByRole("region", { name: "Ingestion runs" });
    const [newest, older] = within(runs).getAllByRole("listitem");
    expect(within(newest).getByText("Succeeded")).toBeInTheDocument();
    // Discovered 3 = inserted 2 + duplicate 1: what an operator reads a run for.
    expect(within(newest).getByText("Discovered").closest("div")).toHaveTextContent("3");
    expect(within(newest).getByText("Inserted").closest("div")).toHaveTextContent("2");
    expect(within(newest).getByText("Duplicate").closest("div")).toHaveTextContent("1");
    // By the Status cell, not by the word: "Failed" is also a counter's term, and
    // a run that failed is not the same fact as a run with failed items.
    expect(within(older).getByText("Status").closest("div")).toHaveTextContent("Failed");
    // Story 10: a failed run is diagnosable here, not only in the server log.
    expect(within(older).getByText(/ENOTFOUND feed.invalid/)).toBeInTheDocument();
  });

  it("queues a connector run and says so, rather than claiming it ran", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(adminPayload()))
      // #42: the endpoint acknowledges an enqueue; the run itself is the worker's.
      .mockResolvedValueOnce(jsonResponse({ connectorId: "c1", status: "accepted" }, 202))
      .mockResolvedValue(jsonResponse(adminPayload()));

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Run" }));

    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("/api/v1/ingestion/connectors/c1/run");
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ method: "POST" });
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
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(adminPayload({ connectors: [paused] })))
      .mockResolvedValueOnce(jsonResponse({ ...paused, enabled: true }))
      .mockResolvedValue(jsonResponse(adminPayload({ connectors: [{ ...paused, enabled: true }] })));

    renderWithProviders(<AdminDashboard />);

    expect(await screen.findByRole("button", { name: "Run" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Enable" }));

    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("/api/v1/ingestion/connectors/c1");
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });
    // The refetched console shows the connector live, and its Run offered.
    expect(await screen.findByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("states a refused command in the connector register rather than blanking the console", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(adminPayload()))
      .mockResolvedValue(jsonResponse({ error: "Connector is disabled" }, 409));

    renderWithProviders(<AdminDashboard />);

    await userEvent.click(await screen.findByRole("button", { name: "Run" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Connector is disabled");
    // The console is still there: a refused command is not a failed page.
    expect(screen.getByRole("region", { name: "Publishers" })).toBeInTheDocument();
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
