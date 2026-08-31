import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";
import { SYNTHESIS_TIMEOUT_MS } from "../src/generation/config";
import { DEFAULT_PROMPT_PARAMS } from "../src/entities/PromptTemplate";
import type { SelectedEvidence } from "../src/generation/evidence";
import { analysisRequest } from "../src/generation/prompt";
import { validateAnalysis } from "../src/generation/validate";
import { OpenAICompatibleSynthesisProvider } from "../src/synthesis/OpenAICompatibleSynthesisProvider";

// The one live check (ADR-0027), skipped by default so the suite stays offline and needs
// no key — the same arrangement `GDELT_LIVE_SMOKE=1` established. Everything else about
// #54's contract is driven by captured transcripts in tests/fixtures/synthesis; this is
// what notices when a real cheap model stops satisfying it.
//
// The credentials are read out of backend/.env by hand because vitest.config.ts pins
// every provider key empty in process.env, which is what keeps the rest of the suite from
// ever reaching the network by accident.
function configuredProvider(): OpenAICompatibleSynthesisProvider {
  const env = parse(readFileSync(join(__dirname, "..", ".env"), "utf-8"));
  const apiBase = env.SYNTHESIS_API_BASE?.trim();
  const apiKey = env.SYNTHESIS_API_KEY?.trim();
  const model = env.SYNTHESIS_MODEL?.trim();
  if (!apiBase || !apiKey || !model) {
    throw new Error("SYNTHESIS_LIVE_SMOKE needs SYNTHESIS_API_BASE, SYNTHESIS_API_KEY and SYNTHESIS_MODEL in .env");
  }
  return new OpenAICompatibleSynthesisProvider(apiKey, model, apiBase, new URL(apiBase).origin);
}

// Two rows of the shape freezeEvidence stores, so the live model is asked exactly what
// generation asks — the same prompt builder, the same ids, the same validation below it.
const evidence: SelectedEvidence[] = [
  {
    articleId: "11111111-1111-4111-8111-111111111111",
    evidenceId: "A1",
    title: "Pilot line targets 2027 output",
    url: "https://northwind.example/pilot-line",
    publishedAt: new Date("2026-01-02T00:00:00Z"),
    analysisText: "The company said its pilot line will reach volume output in 2027.",
    analysisTextMode: "feed_excerpt",
    publisherId: "22222222-2222-4222-8222-222222222222",
    publisherName: "Northwind Ledger",
    publisherDomain: "northwind.example",
    termsClass: "licensed",
    sourceRank: 1,
    articleContentHash: "live-smoke-a1",
    selectionReason: "earliest_reporting",
    excerpt:
      "The company said its pilot line will reach volume output in 2027, describing the timetable as " +
      "unchanged. Two people familiar with the plan said the subsidy application is still pending.",
  },
  {
    articleId: "33333333-3333-4333-8333-333333333333",
    evidenceId: "A2",
    title: "Subsidy timing still unresolved",
    url: "https://harbour.example/subsidy-timing",
    publishedAt: new Date("2026-01-08T00:00:00Z"),
    analysisText: "Officials would not say when the subsidy decision will land.",
    analysisTextMode: "feed_excerpt",
    publisherId: "44444444-4444-4444-8444-444444444444",
    publisherName: "Harbour Dispatch",
    publisherDomain: "harbour.example",
    termsClass: "licensed",
    sourceRank: 2,
    articleContentHash: "live-smoke-a2",
    selectionReason: "latest_reporting",
    excerpt:
      "Officials would not say when the subsidy decision will land. The company repeated its 2027 target " +
      "for the pilot line and declined to comment on hiring.",
  },
];

describe.runIf(process.env.SYNTHESIS_LIVE_SMOKE === "1")("synthesis live smoke", () => {
  it("answers the real prompt with claims that pass the contract", async () => {
    const frozen = new Map(evidence.map((row) => [row.evidenceId, row.publisherId]));

    const raw = await configuredProvider().complete({
      ...analysisRequest(evidence, "student_context", "feed_excerpt", DEFAULT_PROMPT_PARAMS),
      timeoutMs: SYNTHESIS_TIMEOUT_MS,
    });
    const validated = validateAnalysis(raw, "student_context", frozen, { fullPermittedText: false });

    // The message is part of the assertion: when a live model drifts off the contract,
    // what it did wrong is the whole point of running this.
    expect(validated.ok ? "" : validated.failureMessage).toBe("");
    if (!validated.ok) return;
    expect(validated.claims.length).toBeGreaterThanOrEqual(2);
    for (const claim of validated.claims) {
      expect(claim.citations.length).toBeGreaterThan(0);
      for (const citation of claim.citations) expect(frozen.has(citation.evidenceId)).toBe(true);
    }
  });
});
