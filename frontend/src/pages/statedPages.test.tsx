import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import Account from "./Account";
import HealthStatus from "./HealthStatus";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

// The two stated pages (#37). jsdom does no layout and no cascade, so nothing the
// sweep did to how these pages look is testable here — what is testable is the
// accessibility fix underneath it: each page states what it is in a heading, and
// each states its facts in words a reader can act on rather than the backend's
// own vocabulary. The status page had neither before the sweep.

describe("System status — the stated page", () => {
  it("states what it is, and what the API and database are doing, in words", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "ok", db: "ok", timestamp: "2026-08-29T19:15:28.532Z" }),
    );

    renderWithProviders(<HealthStatus />);

    expect(await screen.findByRole("heading", { level: 1, name: "System status" })).toBeInTheDocument();
    expect(screen.getByText("Responding")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    // The raw instant stays in the machine-readable attribute; the reader gets
    // their own locale's rendering of it, not an ISO string.
    expect(screen.getByText(/2026/)).toHaveAttribute("datetime", "2026-08-29T19:15:28.532Z");
  });
});

describe("Account — the stated page", () => {
  it("states the signed-in identity and offers the same sign-out as the shell", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ id: "u1", email: "student@tessera.local", role: "student" }),
    );

    renderWithProviders(<Account />);

    expect(await screen.findByRole("heading", { level: 1, name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("student@tessera.local")).toBeInTheDocument();
    expect(screen.getByText("student")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
