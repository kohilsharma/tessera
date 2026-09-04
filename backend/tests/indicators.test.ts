import { describe, expect, it } from "vitest";
import { relativeStrengthIndex, simpleMovingAverage, volatility } from "../src/market/indicators";

// Wilder's own 14-period RSI worked example, as published in the standard reference
// documentation of his method. Closes are quoted to two decimals there, and that
// precision matters: at four decimals the published series cannot be reproduced.
// This is the fixture that makes the test worth having — the expected numbers come
// from outside this repo, so the test can fail rather than merely agree with itself.
const WILDER_CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89,
  46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25,
  45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13,
];

describe("simpleMovingAverage", () => {
  it("averages the last `period` closes and ignores older ones", () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5, 6], 3)).toBeCloseTo(5, 10); // (4+5+6)/3
    expect(simpleMovingAverage([10, 20, 30], 3)).toBeCloseTo(20, 10);
  });

  it("answers null rather than a number when the series is shorter than the window", () => {
    expect(simpleMovingAverage([1, 2], 3)).toBeNull();
    expect(simpleMovingAverage([], 1)).toBeNull();
  });

  it("returns the level itself for a flat series", () => {
    expect(simpleMovingAverage([7, 7, 7, 7], 4)).toBeCloseTo(7, 10);
  });
});

describe("relativeStrengthIndex", () => {
  // The whole point of the fixture: an externally published expected value.
  it("reproduces the published 14-period value for Wilder's series", () => {
    expect(relativeStrengthIndex(WILDER_CLOSES.slice(0, 15))).toBeCloseTo(70.464, 3);
  });

  it("tracks the published series as it is smoothed forward", () => {
    const published = [70.464, 66.249, 66.483, 69.346, 66.294];
    published.forEach((expected, offset) => {
      // Wilder's smoothing carries the published table's own rounding forward, so the
      // agreement loosens with distance; 0.01 still fails any wrong algorithm.
      expect(relativeStrengthIndex(WILDER_CLOSES.slice(0, 15 + offset))).toBeCloseTo(expected, 1);
    });
  });

  it("reads a series that only rises as 100 and one that only falls as 0", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(relativeStrengthIndex(rising)).toBe(100);
    expect(relativeStrengthIndex(falling)).toBe(0);
  });

  // A flat series has no gains and no losses, so the usual `avgLoss === 0 -> 100`
  // shortcut would call a motionless price "extremely overbought". Neither, so 50.
  it("reads a flat series as neutral rather than overbought", () => {
    expect(relativeStrengthIndex(new Array(20).fill(50))).toBe(50);
  });

  it("answers null when there are fewer closes than the period needs", () => {
    expect(relativeStrengthIndex(WILDER_CLOSES.slice(0, 14))).toBeNull(); // needs period + 1
    expect(relativeStrengthIndex([1, 2, 3], 14)).toBeNull();
  });
});

describe("volatility", () => {
  it("is zero for a flat series", () => {
    expect(volatility([10, 10, 10, 10, 10])).toBe(0);
  });

  it("annualises the standard deviation of daily returns", () => {
    // Alternating +10%/-9.09% back to the same level, so the six daily log returns are
    // +/-0.095310 and their sample standard deviation is 0.104407. Annualised over 252
    // trading days that is 165.7411%. Computed independently rather than read off this
    // implementation, which is the only way the number is worth asserting.
    const seesaw = [100, 110, 100, 110, 100, 110, 100];
    expect(volatility(seesaw)).toBeCloseTo(165.7411, 3);
  });

  it("grows with the size of the swings", () => {
    const calm = volatility([100, 101, 100, 101, 100, 101, 100])!;
    const wild = volatility([100, 130, 100, 130, 100, 130, 100])!;
    expect(wild).toBeGreaterThan(calm);
  });

  it("answers null when there are too few closes to have a spread", () => {
    expect(volatility([100])).toBeNull();
    expect(volatility([100, 110])).toBeNull(); // one return has no sample deviation
  });
});

// A vendor row can arrive missing, and a hole in the series must not become a NaN
// that silently propagates into a displayed indicator.
describe("a series with gaps", () => {
  const holed = [10, 11, Number.NaN, 13, 14, 15];
  it("refuses a non-finite close rather than returning NaN", () => {
    expect(simpleMovingAverage(holed, 3)).toBeNull();
    expect(volatility(holed)).toBeNull();
    expect(relativeStrengthIndex([...holed, ...new Array(15).fill(16)], 14)).toBeNull();
  });

  it("refuses a period that is not a positive whole number", () => {
    expect(simpleMovingAverage([1, 2, 3], 0)).toBeNull();
    expect(simpleMovingAverage([1, 2, 3], -1)).toBeNull();
    expect(simpleMovingAverage([1, 2, 3], 1.5)).toBeNull();
  });
});
