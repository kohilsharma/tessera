import { describe, expect, it } from "vitest";
import { buildCoverageSpectrum } from "../src/lib/coverageSpectrum";

const article = (leaning: "left" | "lean_left" | "center" | "lean_right" | "right" | null) => ({
  publisher: { leaning },
});

describe("coverage spectrum", () => {
  it("counts accepted Articles by the collapsed leaning band and keeps unrated coverage visible", () => {
    expect(
      buildCoverageSpectrum([
        article("left"),
        article("lean_left"),
        article("center"),
        article("lean_right"),
        article("right"),
        article(null),
      ]),
    ).toEqual({ left: 2, centre: 1, right: 2, unrated: 1, total: 6, blindspot: null });
  });

  it("calls out a one-sided rated corpus", () => {
    expect(buildCoverageSpectrum([article("left"), article("lean_left"), article("left"), article(null)])).toMatchObject({
      left: 3,
      unrated: 1,
      total: 4,
      blindspot: "left",
    });
  });

  it("does not turn a mostly-unrated corpus into a political finding", () => {
    expect(buildCoverageSpectrum([article("left"), article(null), article(null), article(null)])).toMatchObject({
      blindspot: null,
    });
  });

  it("does not call unrated coverage a blindspot", () => {
    expect(buildCoverageSpectrum([article(null), article(null)])).toMatchObject({
      unrated: 2,
      blindspot: null,
    });
  });

  it("does not call centre-heavy coverage a blindspot", () => {
    expect(buildCoverageSpectrum([article("center"), article("center"), article("center")])).toMatchObject({
      blindspot: null,
    });
  });
});
