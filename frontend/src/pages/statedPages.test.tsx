import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Account from "./Account";
import HealthStatus from "./HealthStatus";
import { ThemeSync } from "../components/ThemeSync";
import { setToken } from "../auth/token";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

const student = { id: "u1", email: "student@tessera.local", role: "student", colorMode: "system" };

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
    vi.mocked(fetch).mockResolvedValue(jsonResponse(student));

    renderWithProviders(<Account />);

    expect(await screen.findByRole("heading", { level: 1, name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("student@tessera.local")).toBeInTheDocument();
    expect(screen.getByText("student")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  // The Role Theme is stated, not offered (DESIGN.md §3, #75): the reader is told
  // which product their role gives them and that the role is what decided it,
  // because a control they cannot have is worse than a fact they can read.
  it("states the Role Theme the role gives, and that the role is what set it", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(student));

    renderWithProviders(<Account />);

    expect(await screen.findByText("studio — set by your role")).toBeInTheDocument();
    // Named in full: a bare "Theme" is a GDELT subject code everywhere else in
    // the product, and this register sits two rows from the reader's role.
    expect(screen.getByText("Role Theme")).toBeInTheDocument();
    expect(screen.queryByLabelText("Role Theme")).not.toBeInTheDocument();
  });

  it("saves the light/dark override and repaints from the answer", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(student))
      .mockResolvedValueOnce(jsonResponse({ ...student, colorMode: "dark" }));

    // ThemeSync beside the page, as main.tsx renders it: the mutation repaints by
    // writing ["me"], which is the entry ThemeSync watches — one cache, so both
    // components share the single getMe the page already asked for.
    setToken("a.jwt.token");
    renderWithProviders(
      <>
        <ThemeSync />
        <Account />
      </>,
    );
    await userEvent.selectOptions(await screen.findByLabelText("Appearance"), "dark");

    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    const [url, init] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/me");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ colorMode: "dark" });
  });

  it("says so in the field when the save is refused, and keeps the stored mode", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(student))
      .mockResolvedValueOnce(jsonResponse({ error: "Could not save your appearance" }, 422));

    renderWithProviders(<Account />);
    await userEvent.selectOptions(await screen.findByLabelText("Appearance"), "light");

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your appearance");
    expect(screen.getByLabelText("Appearance")).toHaveValue("system");
  });
});
