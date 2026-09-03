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

// DESIGN.md §7's one piece of theatre, and the one number behind it: the CSS block
// in styles.css stages its delays to land the last property exactly here, so the
// class comes off as the sweep ends rather than before or after it.
export const THEME_SWEEP_MS = 700;

// The two classes the sweep wears. The second is added only when the sweep also
// crosses light/dark, because that case cannot be cross-faded: ink and paper swap
// ends, so interpolating both passes them through each other and the text is
// briefly invisible against its own background (measured: 1.15:1 for ~122ms,
// against DESIGN.md §3's 4.5:1 floor). styles.css answers it by swapping those two
// tokens outright there and letting the rules and accents sweep as usual.
const SWEEP_CLASS = "theme-transition";
const MODE_FLIP_CLASS = "theme-transition--mode-flip";

let transitionTimer: number | undefined;
let resolveSweep: (() => void) | undefined;
let sweepSettled: Promise<void> = Promise.resolve();

/**
 * Resolves when the sweep started by transitionTheme() is over — already resolved
 * when none is running, so awaiting it is always safe.
 *
 * A caller navigating away from the page it just retinted has to wait on this: a
 * CSS transition cannot run on a node the browser has only just inserted, so
 * replacing the DOM mid-sweep (and /login and /dashboard are different layouts,
 * so navigating does exactly that) leaves nothing painted to retint (#78).
 */
export function themeTransitionSettled(): Promise<void> {
  return sweepSettled;
}

export function cancelThemeTransition(): void {
  if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
  transitionTimer = undefined;
  document.documentElement.classList.remove(SWEEP_CLASS, MODE_FLIP_CLASS);
  // Resolved, not abandoned: a sign-out mid-sweep must not strand whoever is
  // waiting to navigate on a promise that will now never be kept.
  resolveSweep?.();
  resolveSweep = undefined;
}

export function transitionTheme(role: string | null | undefined, mode: ColorMode): void {
  const html = document.documentElement;
  cancelThemeTransition();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    applyTheme(role, mode);
    return;
  }

  // Read before applyTheme, which is what changes it.
  const crossesMode = html.classList.contains("dark") !== isDark(mode);

  sweepSettled = new Promise<void>((resolve) => (resolveSweep = resolve));
  html.classList.add(SWEEP_CLASS);
  html.classList.toggle(MODE_FLIP_CLASS, crossesMode);
  applyTheme(role, mode);
  transitionTimer = window.setTimeout(() => {
    transitionTimer = undefined;
    html.classList.remove(SWEEP_CLASS, MODE_FLIP_CLASS);
    resolveSweep?.();
    resolveSweep = undefined;
  }, THEME_SWEEP_MS);
}
