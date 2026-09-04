import { DailyBar, MarketProvider, Quote } from "./MarketProvider";

// Tiingo's IEX quote row. Their names, not ours.
type TiingoQuote = {
  ticker?: string;
  tngoLast?: number | null; // Tiingo's composite last price
  last?: number | null; // IEX last sale; null outside market hours
  prevClose?: number | null;
  timestamp?: string | null;
};

type TiingoDaily = {
  date?: string;
  close?: number | null;
  adjClose?: number | null;
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
    return (await this.quotes([ticker]))[0] ?? null;
  }

  async quotes(tickers: string[]): Promise<(Quote | null)[]> {
    const url = `${this.apiBase}/iex/?tickers=${encodeURIComponent(tickers.join(","))}`;
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
    if (!res.ok) throw new Error(`tiingo quote for ${tickers.join(",")} failed: ${res.status}`);
    const rows = (await res.json()) as TiingoQuote[];
    const quoteRows = Array.isArray(rows) ? rows : [];
    const byTicker = new Map(quoteRows.map((row) => [row.ticker?.toUpperCase(), row]));

    return tickers.map((ticker) => {
      const row = byTicker.get(ticker.toUpperCase()) ?? (tickers.length === 1 && quoteRows.length === 1 ? quoteRows[0] : undefined);
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
    });
  }

  async dailySeries(ticker: string): Promise<DailyBar[]> {
    const startDate = new Date(Date.now() - 370 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `${this.apiBase}/tiingo/daily/${encodeURIComponent(ticker)}/prices?startDate=${startDate}`;
    const res = await fetch(url, {
      redirect: "error",
      headers: { Authorization: `Token ${this.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`tiingo daily series for ${ticker} failed: ${res.status}`);
    const rows = (await res.json()) as TiingoDaily[];
    return Array.isArray(rows)
      ? rows.flatMap((row) => {
          if (
            typeof row.date !== "string" ||
            typeof row.close !== "number" ||
            typeof row.adjClose !== "number" ||
            !Number.isFinite(row.close) ||
            !Number.isFinite(row.adjClose)
          ) return [];
          return [{ date: new Date(row.date).toISOString(), close: row.close, adjClose: row.adjClose }];
        })
      : [];
  }
}
