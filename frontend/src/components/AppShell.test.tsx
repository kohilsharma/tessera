import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import { getToken, setToken } from "../auth/token";
import { jsonResponse } from "../test/renderWithProviders";

function renderShell(route = "/stories") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/stories" element={<p>Stories page</p>} />
            <Route path="/search" element={<p>Search page</p>} />
          </Route>
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppShell", () => {
  it("renders primary nav marking the current route, without waiting on /auth/me", () => {
    setToken("a.jwt.token");
    vi.mocked(fetch).mockReturnValue(new Promise(() => {})); // /auth/me never resolves

    renderShell("/stories");

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByRole("link", { name: "Stories" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Search" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  // #96: the timeline reading existed under /search and nobody found it. Its own
  // destination, and an icon on every entry rather than on one — an icon on one of six
  // reads as an accident. Each icon is decorative, so the label is still the whole
  // accessible name a reader hears and every assertion here matches on it alone.
  it("offers the timeline as a destination of its own, iconed like every other", () => {
    setToken("a.jwt.token");
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    renderShell("/stories");

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/timeline");
    for (const label of ["Stories", "Search", "Timeline", "Graph", "My Briefs", "Flashcards"]) {
      expect(within(nav).getByRole("link", { name: label }).querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });

  it("fills in the identity control once /auth/me resolves, and signs out from it", async () => {
    setToken("a.jwt.token");
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "u1", email: "student@tessera.local", role: "student" }));

    renderShell("/stories");

    const email = await screen.findByText("student@tessera.local");
    await userEvent.click(email);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(getToken()).toBeNull();
    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("shows a retry when /auth/me fails", async () => {
    setToken("a.jwt.token");
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("server unavailable"))
      .mockResolvedValueOnce(jsonResponse({ id: "u1", email: "student@tessera.local", role: "student" }));

    renderShell("/stories");

    expect(await screen.findByRole("alert")).toHaveTextContent("Identity unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("student@tessera.local")).toBeInTheDocument();
  });
});
