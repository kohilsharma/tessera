import type { UserRole } from "./api/client";

// DESIGN.md §3, #75. Two axes, and only one of them is the reader's: the role
// picks the theme, the account picks which of that theme's two modes to wear.
export type ThemeName = "newsroom" | "terminal" | "studio";

// Mirrors COLOR_MODES in backend/src/entities/User.ts. It lives here rather than
// in api/client.ts because it is a display vocabulary, and because client.ts
// needs applyTheme() at runtime — one direction of import, and the UserRole above
// is type-only, so nothing circular survives to the bundle.
export const COLOR_MODES = ["system", "light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

// Exhaustive over UserRole on purpose: a fourth role added to the backend should
// fail to compile here rather than quietly theme itself as the signed-out product.
export const ROLE_THEMES: Record<UserRole, ThemeName> = {
  admin: "newsroom",
  investor: "terminal",
  student: "studio",
};

// Login, register and /status have no role to read, so they wear the Admin
// theme — the editorial one, which is what an unsigned visitor should meet.
export const SIGNED_OUT_THEME: ThemeName = "newsroom";

// Total, deliberately: ~25 `font:` shorthands resolve var(--font-mono) out of a
// [data-theme] block, so an unset attribute is not a plain page but a broken one.
// An unrecognised role therefore themes as signed-out rather than as nothing —
// hence the cast, which is the point: the argument is whatever a token happened
// to carry, not something already known to be a role.
export function themeForRole(role: string | null | undefined): ThemeName {
  return ROLE_THEMES[role as UserRole] ?? SIGNED_OUT_THEME;
}

export function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function isDark(mode: ColorMode): boolean {
  return mode === "system" ? prefersDark() : mode === "dark";
}

// The override lives on the User row, so this is only a seed for the first paint
// of the next visit — the server's answer overwrites it the moment it lands.
const MODE_HINT_KEY = "tessera_color_mode";

export function readModeHint(): ColorMode {
  const hint = localStorage.getItem(MODE_HINT_KEY);
  return COLOR_MODES.includes(hint as ColorMode) ? (hint as ColorMode) : "system";
}

export function writeModeHint(mode: ColorMode): void {
  localStorage.setItem(MODE_HINT_KEY, mode);
}

export function applyTheme(role: string | null | undefined, mode: ColorMode): void {
  const html = document.documentElement;
  html.dataset.theme = themeForRole(role);
  html.classList.toggle("dark", isDark(mode));

  // The browser chrome cannot be set from CSS, and media-scoped <meta>s stop
  // working the moment an account can override the media query — so the one meta
  // is written from whatever --paper actually resolved to. Empty in jsdom, and an
  // empty content= would blank the address bar, so only a real value is written.
  const paper = getComputedStyle(html).getPropertyValue("--paper").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (paper && meta) meta.setAttribute("content", paper);
}
