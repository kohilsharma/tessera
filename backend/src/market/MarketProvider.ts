// ADR-0036: the market seam is the third instance of ADR-0003's pattern — a narrow
// interface, a real provider selected from env, and a deterministic Mock beside it so
// the demo runs offline on the same code path.
//
// Narrow deliberately: one symbol in, one Quote out. Everything that makes a market
// panel trustworthy is above this seam — the indicators are ours and arithmetic (#88),
// the Read is validated like any other generated claim (#90) — so nothing here needs to
// grow when those land.

export interface Quote {
  ticker: string;
  price: number;
  // What the day did, as the provider reports it rather than as we subtract it: a
  // provider's own previous close accounts for splits and dividends and ours would not.
  change: number;
  changePercent: number;
  previousClose: number;
  asOf: string;
  // The rater's name lives inside the value, for the reason ADR-0035 gives for a
  // publisher leaning: a surface cannot arrange the parts into a number with nobody's
  // name on it. A Mock price is a plausible-looking number, which is exactly the kind
  // that must never be displayed as if a market produced it.
  source: "finnhub" | "mock";
}

export interface MarketProvider {
  // `null` is an answer: this provider has no quote for that Ticker. Being unreachable
  // is not an answer and throws instead. Both leave a market panel showing nothing
  // (spec §4), but only the first is worth caching — see `quote()` in ./index.ts.
  quote(ticker: string): Promise<Quote | null>;
}

// Finnhub answers an unknown Ticker with a 200 and zeroes rather than a 404, so a
// Ticker is checked before it becomes a URL query or a cache key. US tickers are
// letters with an optional class or exchange suffix; anything else is not a Ticker.
const TICKER = /^[A-Z][A-Z0-9]{0,6}(?:[.\-][A-Z]{1,3})?$/;

export function normalizeTicker(ticker: string): string | null {
  const upper = ticker.trim().toUpperCase();
  return TICKER.test(upper) ? upper : null;
}
