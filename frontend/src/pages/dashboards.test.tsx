import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
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
  it("shows the three operator registers under their own headings", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
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
        publishers: [{ id: "p1", name: "The Ledger", domain: "ledger.example", articleCount: 7 }],
      }),
    );

    renderWithProviders(<AdminDashboard />);

    const accounts = await screen.findByRole("region", { name: "Accounts" });
    expect(within(accounts).getByText("4")).toBeInTheDocument();

    const connectors = screen.getByRole("region", { name: "Ingestion connectors" });
    expect(within(connectors).getByText("GDELT GKG")).toBeInTheDocument();
    expect(within(connectors).getByText("Enabled")).toBeInTheDocument();

    const publishers = screen.getByRole("region", { name: "Publishers" });
    expect(within(publishers).getByText("ledger.example")).toBeInTheDocument();
    expect(within(publishers).getByText("7")).toBeInTheDocument();
  });
});

describe("Role dashboard routing", () => {
  it("refuses a dashboard that is not the caller's, in the error treatment", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ id: "u1", email: "student@tessera.local", role: "student" }),
    );

    renderWithProviders(<RoleDashboard />, { route: "/dashboard/admin", path: "/dashboard/:role" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your account is a student, so that dashboard is not yours.",
    );
  });
});
