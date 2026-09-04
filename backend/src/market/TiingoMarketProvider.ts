import { MarketProvider, Quote } from "./MarketProvider";

// Tiingo's IEX quote row. Their names, not ours.
type TiingoQuote = {
  ticker?: string;
  tngoLast?: number | null; // Tiingo's composite last price
  last?: number | null; // IEX last sale; null outside market hours
  prevClose?: number | null;
  timestamp?: string | null;
};

const REQUEST_TIMEOUT_MS = 5_000;

export class TiingoMarketProvider implements MarketProvider {
  private readonly apiBase: string;

  constructor(
    private readonly apiKey: string,
    apiBase: string,
  ) {
    const endpoint = new URL(apiBase);
    if (endpoint.protocol !== "https:") throw new Error("MARKET_API_BASE must be an https endpoint");
    this.apiBase = apiBase.replace(/\/$/, "");
  }

  async quote(ticker: string): Promise<Quote | null> {
    // The `?tickers=` form takes a comma-separated list and answers all of them in one
    // request. Only one is asked for here because `quote()` above caches per Ticker;
    // the batch form is what a watchlist refresh should use (#92), and it is why a
    // 50-requests-an-hour limit is not the constraint it looks like.
    const url = `${this.apiBase}/iex/?tickers=${encodeURIComponent(ticker)}`;
    // The token goes in a header rather than the query string so it stays out of request
    // logs and out of any redirect target. No retry loop: a quote is a best-effort read
    // behind a cache, and retrying into a rate limit spends the budget the cache protects.
    const res = await fetch(url, {
      redirect: "error",
      headers: { Authorization: `Token ${this.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // A failure is thrown rather than returned, so the caller can tell "Tiingo is down"
    // from "nothing trades under that Ticker" and cache only the second.
    if (!res.ok) throw new Error(`tiingo quote for ${ticker} failed: ${res.status}`);
    const rows = (await res.json()) as TiingoQuote[];

    // An unknown Ticker is an empty array — an answer, and a much plainer one than the
    // zeroed 200 the previous provider used to say the same thing (ADR-0036).
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const price = row?.tngoLast ?? row?.last;
    if (!row || typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;

    const previousClose = typeof row.prevClose === "number" ? row.prevClose : 0;
    // Tiingo reports no change field, so it is subtracted here — but from *their*
    // previous close, which already accounts for splits and dividends. A close we had
    // stored ourselves would not.
    const change = previousClose > 0 ? price - previousClose : 0;
    return {
      ticker,
      price,
      change,
      changePercent: previousClose > 0 ? (change / previousClose) * 100 : 0,
      previousClose,
      // Their timestamp, not now(): outside market hours this is the close, and a panel
      // has to be able to say how stale the price it is drawing actually is.
      asOf: row.timestamp ? new Date(row.timestamp).toISOString() : new Date().toISOString(),
      source: "tiingo",
    };
  }
}
