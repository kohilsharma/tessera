import { MarketProvider, Quote } from "./MarketProvider";

// Finnhub's quote response. Single letters are theirs, not ours.
type FinnhubQuote = {
  c?: number; // current
  d?: number | null; // change
  dp?: number | null; // change, percent
  pc?: number; // previous close
  t?: number; // as of, unix seconds
};

const REQUEST_TIMEOUT_MS = 5_000;

export class FinnhubMarketProvider implements MarketProvider {
  private readonly apiBase: string;

  constructor(
    private readonly apiKey: string,
    apiBase: string,
  ) {
    const endpoint = new URL(apiBase);
    if (endpoint.protocol !== "https:") throw new Error("MARKET_API_BASE must be an https endpoint");
    this.apiBase = apiBase.replace(/\/$/, "");
  }

  // `symbol` is Finnhub's name for it on the wire; ours is Ticker (CONTEXT.md).
  async quote(ticker: string): Promise<Quote | null> {
    const url = `${this.apiBase}/quote?symbol=${encodeURIComponent(ticker)}`;
    // The token goes in a header rather than the query string so it stays out of
    // request logs and out of any redirect target. No retry loop: a quote is a
    // best-effort read behind a cache, and the free tier's budget is 60 calls a minute
    // — retrying into a rate limit spends the budget the cache exists to protect.
    const res = await fetch(url, {
      redirect: "error",
      headers: { "X-Finnhub-Token": this.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // A failure is thrown rather than returned, so the caller can tell "Finnhub is
    // down" from "nothing trades under that ticker" and cache only the second.
    if (!res.ok) throw new Error(`finnhub quote for ${ticker} failed: ${res.status}`);
    const payload = (await res.json()) as FinnhubQuote;

    // An unknown Ticker is a 200 with every field zeroed, so the zero *is* the 404 and
    // has to be read as one. A real US equity never trades at zero, and a genuine halt
    // still carries a previous close.
    const price = payload.c ?? 0;
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
      ticker,
      price,
      change: payload.d ?? 0,
      changePercent: payload.dp ?? 0,
      previousClose: payload.pc ?? 0,
      // `t` is the last trade, which outside market hours is hours old. Reporting it
      // rather than now() is the point — a panel can say how stale a price is.
      asOf: new Date((payload.t && payload.t > 0 ? payload.t : Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      source: "finnhub",
    };
  }
}
