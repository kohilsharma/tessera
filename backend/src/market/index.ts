import { cacheGet, cacheSet, ttlFromEnv } from "../lib/cache";
import { TiingoMarketProvider } from "./TiingoMarketProvider";
import { MarketProvider, Quote, normalizeTicker } from "./MarketProvider";
import { MockMarketProvider } from "./MockMarketProvider";

type MarketProviderChoice = "mock" | "tiingo";

const DEFAULT_TTL_SECONDS = 60;

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required for the selected market provider`);
  return value;
}

function explicitChoice(): MarketProviderChoice | undefined {
  const value = process.env.MARKET_PROVIDER?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "mock" || value === "tiingo") return value;
  throw new Error(`MARKET_PROVIDER must be mock or tiingo; got "${value}"`);
}

export function createMarketProvider(): MarketProvider {
  const apiKey = process.env.MARKET_API_KEY?.trim();
  const choice = explicitChoice() ?? (apiKey ? "tiingo" : "mock");
  if (choice === "mock") {
    // The embedding seam warns on the same fallback, and a Mock *price* earns it more
    // than a Mock vector does: it is a plausible-looking number, and only the `source`
    // on the Quote says no market set it.
    if (process.env.NODE_ENV !== "test" && !process.env.MARKET_PROVIDER) {
      console.warn("[market] no MARKET_API_KEY set — using the Mock provider; prices are simulated.");
    }
    return new MockMarketProvider();
  }
  if (!apiKey) throw new Error("MARKET_PROVIDER=tiingo needs MARKET_API_KEY");
  return new TiingoMarketProvider(apiKey, required("MARKET_API_BASE"));
}

// Cached against #81's Redis seam, which fails open: with no `REDIS_URL`, or with Redis
// down, every call goes to the provider and the feature still works. The TTL is what
// keeps a Story panel inside Tiingo's 50-requests-an-hour free tier — one Ticker on one
// busy page is one call a minute however many readers open it — which is why this is the
// door every market surface reads through, rather than `createMarketProvider` (ADR-0036).
//
// The cached value wraps the Quote so a stored "nothing trades under that Ticker" is
// distinguishable from a cache miss: such a Ticker would otherwise be re-asked on every
// read for the whole life of the row.
type CachedQuote = { quote: Quote | null };

function isCachedQuote(value: CachedQuote | null): value is CachedQuote {
  // Cached JSON is untrusted — a key written by an older shape, or by hand.
  return value !== null && (value.quote === null || typeof value.quote?.price === "number");
}

export async function quote(ticker: string): Promise<Quote | null> {
  const normalized = normalizeTicker(ticker);
  if (!normalized) return null;

  const key = `tessera:quote:v1:${normalized}`;
  const cached = await cacheGet<CachedQuote>(key);
  if (isCachedQuote(cached)) return cached.quote;

  // Built outside the try: a bad `MARKET_API_BASE` or a missing key is a misconfiguration
  // that must fail loudly, not degrade into the same empty panel an unknown Ticker gives.
  const provider = createMarketProvider();
  let fresh: Quote | null;
  try {
    fresh = await provider.quote(normalized);
  } catch (error) {
    // An outage is not an answer, so nothing is stored: caching it would hold an empty
    // panel on screen for the whole TTL after the provider came back.
    console.warn(`[market] no quote for ${normalized}: ${(error as Error).message}`);
    return null;
  }
  await cacheSet<CachedQuote>(key, { quote: fresh }, ttlFromEnv("MARKET_QUOTE_CACHE_TTL_SECONDS", DEFAULT_TTL_SECONDS));
  return fresh;
}

export type { MarketProvider, Quote } from "./MarketProvider";
