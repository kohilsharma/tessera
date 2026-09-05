import { createHash } from "node:crypto";
import { cacheGet, cacheSet, ttlFromEnv } from "../lib/cache";
import { parseModelObject } from "../lib/modelJson";
import { hasProhibitedInvestorLanguage } from "../generation/validate";
import type { SynthesisProvider } from "../synthesis";

export type MarketReadInput = {
  storyId: string;
  reporting: {
    evidenceId: string;
    articleId: string;
    publisherName: string;
    title: string;
    excerpt: string;
  }[];
  markets: {
    ticker: string;
    canonicalName: string;
    price: number;
    change: number;
    changePercent: number;
    sma50: number | null;
    rsi14: number | null;
    volatility: number | null;
  }[];
};

// The completion budget. See SYNTHESIS_MAX_TOKENS in generation/config.ts: the read is
// short, but a reasoning model's working is billed against the same completion, so a
// ceiling sized for the answer alone never reaches it.
const MARKET_READ_MAX_TOKENS = Number(process.env.MARKET_READ_MAX_TOKENS ?? 2_000);

// Either the read, or the rule that refused it. Both are answers the Investor surface
// can render; neither is an error.
export type MarketReadOutcome = MarketRead | { refused: MarketReadRefusal };
export type MarketReadRefusal =
  "unparseable_output" | "schema_violation" | "claim_without_citation" | "unknown_evidence_id" | "prohibited_investor_language";

export type MarketRead = {
  read: string;
  citations: string[];
  contentHash: string;
  provider: string;
  model: string;
  generatedAt: string;
  evidenceSetId: string | null;
  citationDetails: { evidenceId: string; articleId: string; title: string; publisherName: string }[];
};

export type MarketReadValidation =
  | { ok: true; read: string; citations: string[] }
  | { ok: false; code: MarketReadRefusal };

function normaliseCitation(value: string): string {
  return value.trim().replace(/^\[|\]$/g, "").trim().toUpperCase();
}

export function validateMarketRead(raw: string, evidence: Map<string, string>): MarketReadValidation {
  const parsed = parseModelObject(raw);
  if (!parsed) return { ok: false, code: "unparseable_output" };
  if (typeof parsed.read !== "string" || !parsed.read.trim()) return { ok: false, code: "schema_violation" };
  if (!Array.isArray(parsed.citations) || parsed.citations.some((id) => typeof id !== "string")) {
    return { ok: false, code: "schema_violation" };
  }
  const citations = [...new Set((parsed.citations as string[]).map(normaliseCitation))].filter(Boolean);
  if (citations.length === 0) return { ok: false, code: "claim_without_citation" };
  if (citations.some((id) => !evidence.has(id))) return { ok: false, code: "unknown_evidence_id" };
  const read = parsed.read.trim();
  if (hasProhibitedInvestorLanguage(read)) return { ok: false, code: "prohibited_investor_language" };
  if (/\b(?:caused|causes|led to|drives|drove|because of|due to)\b/i.test(read)) return { ok: false, code: "prohibited_investor_language" };
  return { ok: true, read, citations };
}

function promptFor(input: MarketReadInput): string {
  const reporting = input.reporting.map((row) =>
    `[${row.evidenceId}] ${row.publisherName} — "${row.title}"\n${row.excerpt}`,
  );
  const markets = input.markets.map((market) =>
    `${market.canonicalName} (${market.ticker}): price ${market.price.toFixed(2)}, ` +
    `day change ${market.change.toFixed(2)} (${market.changePercent.toFixed(2)}%), ` +
    `SMA-50 ${market.sma50 === null ? "unavailable" : market.sma50.toFixed(2)}, ` +
    `RSI-14 ${market.rsi14 === null ? "unavailable" : market.rsi14.toFixed(2)}, ` +
    `annualized volatility ${market.volatility === null ? "unavailable" : `${market.volatility.toFixed(2)}%`}`,
  );
  return [
    "Write one concise market read about this Story for an Investor.",
    "Describe what the reporting says and what the indicators show.",
    "Do not claim that the reporting caused a price move, and do not give advice, recommendations or price targets.",
    "Answer with JSON only: {\"read\": string, \"citations\": array of evidence ids}.",
    "Citations must refer to the reporting ids below.",
    "",
    "REPORTING",
    ...reporting,
    "",
    "INDICATORS",
    ...markets,
  ].join("\n");
}

function hashInput(input: MarketReadInput, provider: string, model: string): string {
  return createHash("sha256").update(JSON.stringify({ input, provider, model })).digest("hex");
}

type CachedMarketRead = Omit<MarketRead, "contentHash">;

function isCached(value: CachedMarketRead | null): value is CachedMarketRead {
  return Boolean(value && typeof value.read === "string" && Array.isArray(value.citations) && typeof value.generatedAt === "string");
}

export async function generateMarketRead(
  provider: SynthesisProvider,
  input: MarketReadInput,
  providerName: string,
  model: string,
  evidenceSetId: string | null = null,
): Promise<MarketReadOutcome> {
  if (input.reporting.length === 0 || input.markets.length === 0) throw new Error("A market read needs reporting and market data");
  const contentHash = hashInput(input, providerName, model);
  const key = `tessera:market-read:v1:${contentHash}`;
  const cached = await cacheGet<CachedMarketRead>(key);
  if (isCached(cached)) return { ...cached, contentHash };

  const raw = await provider.complete({
    task: "market_read",
    system: "You write evidence-grounded market intelligence without financial advice.",
    prompt: promptFor(input),
    json: true,
    // A short read, but the budget has to cover the reasoning ahead of it — see
    // SYNTHESIS_MAX_TOKENS. At 500 a thinking model never reached its own JSON.
    maxTokens: MARKET_READ_MAX_TOKENS,
  });
  const validation = validateMarketRead(raw, new Map(input.reporting.map((row) => [row.evidenceId, row.articleId])));
  // A refusal is an answer, not a fault: the guard did its job, and the caller needs to
  // be told which rule stopped the read rather than being handed a 500 that says the
  // server broke. Nothing is cached — a refusal must not become the stored answer.
  if (!validation.ok) return { refused: validation.code };
  const result: MarketRead = {
    ...validation,
    contentHash,
    provider: providerName,
    model,
    generatedAt: new Date().toISOString(),
    evidenceSetId,
    citationDetails: input.reporting.filter((row) => validation.citations.includes(row.evidenceId)).map((row) => ({ evidenceId: row.evidenceId, articleId: row.articleId, title: row.title, publisherName: row.publisherName })),
  };
  await cacheSet<CachedMarketRead>(key, result, ttlFromEnv("MARKET_READ_CACHE_TTL_SECONDS", 3_600));
  return result;
}
