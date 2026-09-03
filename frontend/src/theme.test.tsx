import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { applyTheme, isDark, readModeHint, themeForRole, writeModeHint } from "./theme";
import { roleFromToken, setToken } from "./auth/token";
import { ThemeSync } from "./components/ThemeSync";
import { jsonResponse, renderWithProviders } from "./test/renderWithProviders";

// #75's contract, and the reason it is worth a test of its own: every visual rule
// in the app hangs off `data-theme` on <html>, so the mapping from a role to a
// theme name is the one place a wrong answer changes the whole product at once.
// jsdom applies no stylesheet, so what is testable here is the attribute and the
// class — which is exactly what CSS keys off.

const html = () => document.documentElement;

// jsdom implements no matchMedia at all, so the 'system' arm has nothing to read
// unless the test provides it. Stubbed rather than faked wholesale: only the one
// query the app asks about.
function stubPrefersDark(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-color-scheme: dark") && matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  html().removeAttribute("data-theme");
  html().classList.remove("dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the role sets the theme", () => {
  it.each([
    ["admin", "newsroom"],
    ["investor", "terminal"],
    ["student", "studio"],
  ])("themes %s as %s", (role, theme) => {
    expect(themeForRole(role)).toBe(theme);
  });

  it("themes a signed-out visitor as newsroom", () => {
    expect(themeForRole(null)).toBe("newsroom");
    expect(themeForRole(undefined)).toBe("newsroom");
  });

  // The fallback is not politeness: ~25 `font:` shorthands resolve --font-mono out
  // of a [data-theme] block, so an unset attribute is a broken page, not a plain
  // one. A role this build has never heard of still has to paint something.
  it("themes an unrecognised role as newsroom rather than leaving <html> unthemed", () => {
    applyTheme("auditor", "light");
    expect(html().dataset.theme).toBe("newsroom");
  });
});

describe("light/dark is the reader's half", () => {
  it("follows prefers-color-scheme when the mode is 'system'", () => {
    stubPrefersDark(true);
    expect(isDark("system")).toBe(true);

    stubPrefersDark(false);
    expect(isDark("system")).toBe(false);
  });

  it("overrides prefers-color-scheme when the mode names one", () => {
    stubPrefersDark(true);
    expect(isDark("light")).toBe(false);

    stubPrefersDark(false);
    expect(isDark("dark")).toBe(true);
  });

  it("reads light when nothing can answer the media query", () => {
    // No matchMedia at all — jsdom, and any environment that predates it.
    expect(isDark("system")).toBe(false);
  });

  it("carries the mode as a class on the same element as the theme", () => {
    applyTheme("investor", "dark");
    expect(html().dataset.theme).toBe("terminal");
    expect(html()).toHaveClass("dark");

    applyTheme("investor", "light");
    expect(html().dataset.theme).toBe("terminal");
    expect(html()).not.toHaveClass("dark");
  });
});

describe("switching accounts switches products", () => {
  it("repaints both axes, leaving nothing of the previous identity", () => {
    stubPrefersDark(false);
    applyTheme("student", "dark");
    expect(html().dataset.theme).toBe("studio");
    expect(html()).toHaveClass("dark");

    applyTheme("admin", "system");
    expect(html().dataset.theme).toBe("newsroom");
    expect(html()).not.toHaveClass("dark");
  });
});

describe("the first-paint mode hint", () => {
  it("round-trips a stored mode", () => {
    writeModeHint("dark");
    expect(readModeHint()).toBe("dark");
  });

  it("reads 'system' for an absent or unrecognised hint", () => {
    expect(readModeHint()).toBe("system");
    localStorage.setItem("tessera_color_mode", "sepia");
    expect(readModeHint()).toBe("system");
  });
});

// The role the first paint uses, before /auth/me has answered. Theming only —
// the server verifies the signature on every request — so an unreadable token is
// a missing role rather than an error.
describe("the role read off the stored token", () => {
  const encode = (payload: object) =>
    `header.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_")}.signature`;

  it("reads the role out of a token's payload", () => {
    setToken(encode({ sub: "u1", role: "investor" }));
    expect(roleFromToken()).toBe("investor");
  });

  it("reads no role when there is no token, or the token is not a JWT", () => {
    expect(roleFromToken()).toBeNull();
    setToken("not-a-jwt");
    expect(roleFromToken()).toBeNull();
  });

  it("reads no role from a payload that carries none", () => {
    setToken(encode({ sub: "u1" }));
    expect(roleFromToken()).toBeNull();
  });

  it("themes what it read, so a reload never flashes the signed-out product", () => {
    setToken(encode({ sub: "u1", role: "investor" }));
    applyTheme(roleFromToken(), readModeHint());
    expect(html().dataset.theme).toBe("terminal");
  });
});

describe("the browser chrome", () => {
  it("leaves the authored theme-color alone when no --paper resolves", () => {
    // jsdom resolves no custom properties, and an empty content= would blank the
    // address bar — so the authored value has to survive.
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#faf8f4");
    document.head.append(meta);

    applyTheme("investor", "dark");

    expect(meta.getAttribute("content")).toBe("#faf8f4");
    meta.remove();
  });
});

describe("ThemeSync", () => {
  it("themes from the server's answer, which outranks the token and the hint", async () => {
    setToken("header.eyJyb2xlIjoiaW52ZXN0b3IifQ.signature"); // {"role":"investor"}
    writeModeHint("light");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ id: "u1", email: "a@b.c", role: "admin", colorMode: "dark" }),
    );

    renderWithProviders(<ThemeSync />);

    await waitFor(() => expect(html().dataset.theme).toBe("newsroom"));
    expect(html()).toHaveClass("dark");
    // Cached for the next first paint, so the reload does not start light.
    expect(readModeHint()).toBe("dark");
  });

  // Load-bearing: authFetch answers a 401 by navigating to /login, so an
  // unguarded /auth/me from a root-level component is a redirect loop on the
  // login page itself.
  it("asks nothing of the API when there is no token", async () => {
    renderWithProviders(<ThemeSync />);

    await waitFor(() => expect(html().dataset.theme).toBe("newsroom"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    const { container } = renderWithProviders(<ThemeSync />);
    expect(container).toBeEmptyDOMElement();
  });

  it("follows the OS while the mode is 'system', and stops following once it is not", async () => {
    const listeners: Array<() => void> = [];
    let osIsDark = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        get matches() {
          return osIsDark;
        },
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
        removeEventListener: vi.fn(),
      })),
    );
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ id: "u1", email: "a@b.c", role: "student", colorMode: "system" }),
    );
    setToken("a.jwt.token");

    renderWithProviders(<ThemeSync />);
    await waitFor(() => expect(html().dataset.theme).toBe("studio"));
    expect(html()).not.toHaveClass("dark");

    osIsDark = true;
    listeners.forEach((fn) => fn());
    expect(html()).toHaveClass("dark");
  });

  it("does not subscribe to the OS when the mode is an override", async () => {
    const addEventListener = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener, removeEventListener: vi.fn() })));
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ id: "u1", email: "a@b.c", role: "student", colorMode: "light" }),
    );
    setToken("a.jwt.token");
    // The hint carries the override into the first render, which is what it is for:
    // seeded from 'system' the component would subscribe once and then drop it.
    writeModeHint("light");

    renderWithProviders(<ThemeSync />);

    await waitFor(() => expect(html().dataset.theme).toBe("studio"));
    expect(html()).not.toHaveClass("dark");
    expect(addEventListener).not.toHaveBeenCalled();
  });
});
