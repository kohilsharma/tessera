import { DailyBar, MarketProvider, Quote } from "./MarketProvider";

// ADR-0003 requires a deterministic Mock so the whole suite, and a no-key demo, runs
// with no provider reachable. Its only input is the Ticker it was asked for, so the
// same Ticker is always the same price — a test can assert on it, and a demo shows the
// same panel twice.
//
// The prices are derived, not invented per ticker: a hardcoded table would be a claim
// about what real companies are worth, and a stale one within a day.
export class MockMarketProvider implements MarketProvider {
  async quote(ticker: string): Promise<Quote | null> {
    return (await this.quotes([ticker]))[0] ?? null;
  }

  async quotes(tickers: string[]): Promise<(Quote | null)[]> {
    return tickers.map((ticker) => {
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
    });
  }

  async dailySeries(ticker: string): Promise<DailyBar[]> {
    const seed = hash(ticker);
    let price = 20 + (seed % 48_000) / 100;
    return Array.from({ length: 260 }, (_, index) => {
      const swing = ((seed + index * 17) % 101 - 50) / 1000;
      price = Math.max(1, price * (1 + swing));
      return {
        date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
        close: round(price),
        adjClose: round(price),
      };
    });
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
