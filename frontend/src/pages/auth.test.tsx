import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Login from "./Login";
import Register from "./Register";
import { logout } from "../api/client";
import { getToken } from "../auth/token";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

const authResponse = {
  token: "a.jwt.token",
  user: { id: "u1", email: "student@tessera.local", role: "student" as const, colorMode: "system" as const },
};

describe("Register — inline validation", () => {
  it("rejects a malformed email before any request", async () => {
    renderWithProviders(<Register />);

    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a password under the minimum length before any request", async () => {
    renderWithProviders(<Register />);

    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password must be at least 8 characters");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces the duplicate-email rejection the API returns", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "Email is already registered" }, 422));

    renderWithProviders(<Register />);
    await userEvent.type(screen.getByLabelText("Email"), "taken@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email is already registered");
    expect(getToken()).toBeNull();
  });

  it("submits the chosen role and stores the token on success", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(authResponse, 201));

    renderWithProviders(<Register />);
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "investor");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(getToken()).toBe("a.jwt.token"));
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/register");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "new@example.com",
      password: "correct-horse",
      role: "investor",
    });
  });

  it("disables the submit button while the request is in flight", async () => {
    let resolve: (res: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((r) => (resolve = r)));

    renderWithProviders(<Register />);
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByRole("button", { name: "Registering…" })).toBeDisabled();

    resolve(jsonResponse(authResponse, 201));
    await waitFor(() => expect(getToken()).toBe("a.jwt.token"));
  });
});

describe("Login", () => {
  it("names the blank fields without telling a visitor which half was wrong", async () => {
    renderWithProviders(<Login />);

    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual(["Enter your email address", "Enter your password"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces the API's 401 message and keeps no token", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "Invalid email or password" }, 401));

    renderWithProviders(<Login />);
    await userEvent.type(screen.getByLabelText("Email"), "student@tessera.local");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(getToken()).toBeNull();
  });

  it("stores the token on a successful login", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(authResponse));

    renderWithProviders(<Login />);
    await userEvent.type(screen.getByLabelText("Email"), "student@tessera.local");
    await userEvent.type(screen.getByLabelText("Password"), "tessera-demo");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(getToken()).toBe("a.jwt.token"));
    expect(document.documentElement).toHaveClass("theme-transition");
  });

  // #75's "switching accounts visibly switches products", at the seam where a
  // session begins: the login page is painted signed-out Newsroom, and the answer
  // that carries the role is what repaints it — not a later refetch.
  it("repaints the page as the signed-in role's product", async () => {
    document.documentElement.dataset.theme = "newsroom";
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ...authResponse, user: { ...authResponse.user, role: "investor", colorMode: "dark" } }),
    );

    renderWithProviders(<Login />);
    await userEvent.type(screen.getByLabelText("Email"), "investor@tessera.local");
    await userEvent.type(screen.getByLabelText("Password"), "tessera-demo");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("terminal"));
    expect(document.documentElement).toHaveClass("dark");
  });

  // #78. The sweep retints the page a reader is looking at, so the navigation has
  // to wait for it — /login and /dashboard are different layouts, and leaving at
  // once replaces every node before a frame paints, which is a transition on
  // nothing. What pays for the wait is the dashboard already being in flight.
  it("holds the signed-out page for the sweep, with the dashboard loading under it", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      Promise.resolve(
        String(input).includes("/auth/login")
          ? jsonResponse(authResponse)
          : jsonResponse({ role: "student", studyCollections: [], flashcards: {} }),
      ),
    );

    renderWithProviders(<Login />, {
      route: "/login",
      path: "/login",
      probe: { path: "/dashboard", element: <p>Dashboard reached</p> },
    });
    await userEvent.type(screen.getByLabelText("Email"), "student@tessera.local");
    await userEvent.type(screen.getByLabelText("Password"), "tessera-demo");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(document.documentElement).toHaveClass("theme-transition"));
    // Still the page being retinted, and its successor's data already requested.
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    // #78 forbids a spinner, and a button reading "Logging in…" through the whole
    // sweep is one with a label on: the request is done, so it stops saying so.
    // Still disabled, because the page is leaving and a second submit must not land.
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
    expect(screen.queryByText("Dashboard reached")).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain("/api/v1/dashboard/student");

    // …and the sweep does end, on the dashboard rather than on the login page.
    expect(await screen.findByText("Dashboard reached", undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("puts the signed-out product back on sign-out", async () => {
    document.documentElement.dataset.theme = "terminal";
    document.documentElement.classList.add("dark");

    logout();

    expect(document.documentElement.dataset.theme).toBe("newsroom");
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
