import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokensCss = read("./tokens.css");
const designMd = read("../../DESIGN.md");

// #74's real deliverable is not that the six palettes exist — it is that they
// cannot quietly stop being legible. DESIGN.md §3 records a measured ratio for
// every palette, so this file re-measures rather than trusting the record: text
// tokens at WCAG AA (4.5:1) against that palette's own --paper, marks and the
// focus ring at 3:1. A hex edit that drops one below its threshold fails here.

const CONTRACT = [
  "--paper", "--paper2", "--ink", "--quiet", "--rule", "--rule2",
  "--left", "--centre", "--right",
  "--agree", "--diverge", "--imply",
  "--wash-agree", "--wash-diverge", "--wash-imply",
  "--agree-text", "--diverge-text", "--imply-text",
  "--on-accent", "--up", "--down", "--focus",
];
const SMALL_TEXT = ["--ink", "--quiet", "--agree-text", "--diverge-text", "--imply-text"];
const MARKS = ["--left", "--centre", "--right", "--agree", "--diverge", "--imply", "--up", "--down", "--focus"];
const CLAIMS = ["agree", "diverge", "imply"];
const AA = 4.5;
const MARK_FLOOR = 3;

/** Every `[data-theme=…]` block in a stylesheet, as declaration maps. */
function palettes(css: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const [, selector, body] of css.matchAll(/(\[data-theme="[a-z]+"\](?:\.dark)?)\s*\{([^}]*)\}/g)) {
    out.set(selector, Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(([, k, v]) => [k, v.trim()])));
  }
  return out;
}

const colours = (p: Record<string, string>) => Object.entries(p).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v));

// WCAG 2.x relative luminance and contrast ratio. Ten lines, so no dependency.
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => channel(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const IMPLEMENTED = palettes(tokensCss);
const PALETTES = [...IMPLEMENTED];
const LIGHT = PALETTES.filter(([selector]) => !selector.endsWith(".dark"));
const DARK = PALETTES.filter(([selector]) => selector.endsWith(".dark"));

describe("the token contract", () => {
  it("declares six palettes: three themes, each light and dark", () => {
    expect(PALETTES.map(([selector]) => selector).sort()).toEqual([
      '[data-theme="newsroom"]', '[data-theme="newsroom"].dark',
      '[data-theme="studio"]', '[data-theme="studio"].dark',
      '[data-theme="terminal"]', '[data-theme="terminal"].dark',
    ]);
  });

  it.each(PALETTES)("%s declares exactly the twenty-two contract tokens", (_selector, tokens) => {
    expect(colours(tokens).map(([k]) => k).sort()).toEqual([...CONTRACT].sort());
  });

  it("gives each theme its own dark ground, so dark does not erase the role", () => {
    const grounds = DARK.map(([, tokens]) => tokens["--paper"]);
    expect(new Set(grounds).size).toBe(3);
  });

  it.each(LIGHT)("%s wires type, shape and depth per theme", (_selector, tokens) => {
    for (const token of ["--font-display", "--font-ui", "--font-mono", "--t-display", "--w-display", "--radius", "--radius-lg", "--shadow"]) {
      expect(tokens[token], token).toBeTruthy();
    }
  });

  it("uses shadow in Studio alone", () => {
    const withDepth = LIGHT.filter(([, tokens]) => tokens["--shadow"] !== "none");
    expect(withDepth.map(([selector]) => selector)).toEqual(['[data-theme="studio"]']);
  });

  it("declares the shared type and spacing scales once, outside the themes", () => {
    const root = tokensCss.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
    const declared = [...root.matchAll(/(--[\w-]+)\s*:/g)].map(([, k]) => k);
    expect(declared).toEqual([
      "--t-title", "--t-heading", "--t-body", "--t-small", "--t-meta", "--t-micro",
      "--s-1", "--s-2", "--s-3", "--s-4", "--s-5", "--s-6", "--s-7", "--s-8", "--s-9",
    ]);
  });
});

describe("contrast, re-measured rather than assumed", () => {
  it.each(PALETTES)("%s: small text meets AA on --paper", (_selector, t) => {
    for (const token of SMALL_TEXT) expect(ratio(t[token], t["--paper"]), token).toBeGreaterThanOrEqual(AA);
  });

  it.each(PALETTES)("%s: marks and the focus ring meet 3:1 on --paper", (_selector, t) => {
    for (const token of MARKS) expect(ratio(t[token], t["--paper"]), token).toBeGreaterThanOrEqual(MARK_FLOOR);
  });

  // Both pairings below clear the 3:1 mark floor in all six palettes but not AA
  // in every one — Studio light is the tightest at 3.35 on a filled accent and
  // 4.23 on a wash. Small text on either needs its own measurement (#76).
  it.each(PALETTES)("%s: --on-accent stays legible on every accent it sits on", (_selector, t) => {
    for (const claim of CLAIMS) expect(ratio(t["--on-accent"], t[`--${claim}`]), claim).toBeGreaterThanOrEqual(MARK_FLOOR);
  });

  it.each(PALETTES)("%s: a claim label stays legible on its own wash", (_selector, t) => {
    for (const claim of CLAIMS) expect(ratio(t[`--${claim}-text`], t[`--wash-${claim}`]), claim).toBeGreaterThanOrEqual(MARK_FLOOR);
  });
});

describe("DESIGN.md §3 is the one source", () => {
  it("declares palettes identical to the specification, hex for hex", () => {
    const specified = palettes(designMd);
    expect(specified.size).toBe(6);
    for (const [selector, tokens] of specified) {
      expect(colours(tokens), selector).toEqual(colours(IMPLEMENTED.get(selector) ?? {}));
    }
  });
});
