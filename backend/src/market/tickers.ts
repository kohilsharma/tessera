import type { EntityManager } from "typeorm";

// A deliberately small, reviewable mapping for organizations common in the
// retained GKG corpus. Names are normalized exactly as graph resolution stores them.
//
// Keyed on the names GDELT actually emits, which is not the same list as the names a
// filing would use: the corpus says "Google" 1,694 times and "Alphabet Inc" never, so a
// map written from corporate identities matches nothing. Trading names and the
// well-known subsidiaries resolve to the issuer that is actually listed — the panel's
// question is which quoted company a story touches, and Instagram's answer to that is
// Meta. Every entry here is a name checked against the retained corpus, not a guess.
export const CURATED_TICKERS: Record<string, string> = {
  amd: "AMD",
  "advanced micro devices": "AMD",
  alphabet: "GOOGL",
  "alphabet inc": "GOOGL",
  amazon: "AMZN",
  "amazon com": "AMZN",
  apple: "AAPL",
  "apple inc": "AAPL",
  intel: "INTC",
  "intel corporation": "INTC",
  "meta platforms": "META",
  "meta platforms inc": "META",
  microsoft: "MSFT",
  "microsoft corporation": "MSFT",
  nvidia: "NVDA",
  "nvidia corporation": "NVDA",
  tsmc: "TSM",
  "taiwan semiconductor manufacturing company": "TSM",
  tesla: "TSLA",
  "tesla inc": "TSLA",
  // Alphabet trades as GOOGL; the corpus names the products, not the holding company.
  google: "GOOGL",
  youtube: "GOOGL",
  // Meta likewise: the two properties are named far more often than the issuer.
  facebook: "META",
  instagram: "META",
  meta: "META",
  boeing: "BA",
  "the boeing company": "BA",
  chevron: "CVX",
  "chevron corporation": "CVX",
  disney: "DIS",
  "walt disney": "DIS",
  "the walt disney company": "DIS",
  netflix: "NFLX",
  "netflix inc": "NFLX",
};

export async function applyCuratedTickers(manager: EntityManager): Promise<void> {
  const entries = Object.entries(CURATED_TICKERS);
  const cases = entries.map((_, index) => `WHEN "normalizedName" = $${index * 2 + 1} THEN $${index * 2 + 2}`).join(" ");
  const names = entries.map((_, index) => `$${index * 2 + 1}`).join(", ");
  await manager.query(
    `UPDATE "entities"
        SET "ticker" = CASE ${cases} END
      WHERE "kind" = 'organization' AND "normalizedName" IN (${names})`,
    entries.flatMap(([name, ticker]) => [name, ticker]),
  );
}
