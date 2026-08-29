import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Login from "./Login";
import Register from "./Register";
import { getToken } from "../auth/token";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

const authResponse = {
  token: "a.jwt.token",
  user: { id: "u1", email: "student@tessera.local", role: "student" as const },
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
  });
});
