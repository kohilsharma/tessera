import { MarketProvider, Quote } from "./MarketProvider";

// ADR-0003 requires a deterministic Mock so the whole suite, and a no-key demo, runs
// with no provider reachable. Its only input is the Ticker it was asked for, so the
// same Ticker is always the same price — a test can assert on it, and a demo shows the
// same panel twice.
//
// The prices are derived, not invented per ticker: a hardcoded table would be a claim
// about what real companies are worth, and a stale one within a day.
export class MockMarketProvider implements MarketProvider {
  async quote(ticker: string): Promise<Quote | null> {
    const seed = hash(ticker);
    const previousClose = round(20 + (seed % 48_000) / 100);
    // A signed swing of at most ±5%, so a panel shows both directions across a
    // watchlist without a run of tickers all moving the same way.
    const changePercent = round(((seed % 1_001) - 500) / 100);
    const price = round(previousClose * (1 + changePercent / 100));
    const change = round(price - previousClose);
    return {
      ticker,
      price,
      change,
      changePercent,
      previousClose,
      // Fixed, not now(): a Mock whose timestamp moves is a Mock two calls disagree
      // about, and the demo's "as of" line would read as live data.
      asOf: "2026-01-01T00:00:00.000Z",
      source: "mock",
    };
  }
}

function hash(ticker: string): number {
  let value = 0;
  for (const character of ticker) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
