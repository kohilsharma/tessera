import type { EntityManager } from "typeorm";

// A deliberately small, reviewable mapping for organizations common in the
// retained GKG corpus. Names are normalized exactly as graph resolution stores them.
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
