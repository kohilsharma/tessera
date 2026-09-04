import { AppDataSource } from "../data-source";
import { ACCEPTED_ASSIGNMENT } from "../lib/storyMembership";
import { dailySeriesResult, quote, quoteResult } from "./index";
import { relativeStrengthIndex, simpleMovingAverage, volatility } from "./indicators";

export type StoryMarket = {
  entity: { id: string; canonicalName: string; ticker: string };
  quote: NonNullable<Awaited<ReturnType<typeof quote>>>;
  indicators: {
    sma50: number | null;
    rsi14: number | null;
    volatility: number | null;
  };
  series: NonNullable<Awaited<ReturnType<typeof dailySeriesResult>>["value"]>;
};

export type StoryMarketResult = {
  market: StoryMarket[] | null;
  status: "ready" | "empty" | "unavailable";
  total: number;
};

type MarketEntity = { id: string; canonicalName: string; ticker: string; total: number };

// Organizations are joined through the same accepted Story membership as every
// reader surface. An alias fold keeps a merged GKG name attached to its survivor.
export async function loadStoryMarket(storyId: string): Promise<StoryMarketResult> {
  const normalizedName = `btrim(regexp_replace(lower(ga."surfaceName"), '[^[:alnum:]]+', ' ', 'g'))`;
  const entities = (await AppDataSource.query(
    `WITH market_entities AS (
       SELECT DISTINCT e."id", e."canonicalName", e."ticker"
         FROM "gkg_annotations" ga
         JOIN "articles" a ON a."id" = ga."articleId"
         LEFT JOIN "entity_aliases" al
                ON al."kind" = ga."kind"
               AND al."normalizedName" = ${normalizedName}
               AND al."featureKey" = ''
         JOIN "entities" e
               ON e."kind" = 'organization'
              AND e."normalizedName" = COALESCE(al."targetNormalizedName", ${normalizedName})
        WHERE a."storyId" = $1
          AND a."storyAssignmentStatus" = $2
          AND ga."kind" = 'organization'
          AND e."ticker" IS NOT NULL
     )
     SELECT market_entities.*, COUNT(*) OVER()::int AS "total"
       FROM market_entities
      ORDER BY "canonicalName" ASC
      LIMIT 8`,
    [storyId, ACCEPTED_ASSIGNMENT],
  )) as MarketEntity[];

  if (entities.length === 0) return { market: null, status: "empty", total: 0 };

  const results = await Promise.all(
    entities.map(async (entity) => {
      const [marketQuote, series] = await Promise.all([quoteResult(entity.ticker), dailySeriesResult(entity.ticker)]);
      if (marketQuote.status === "unavailable" || series.status === "unavailable") {
        return { panel: null, unavailable: true };
      }
      if (!marketQuote.value || !series.value) return { panel: null, unavailable: false };
      const closes = series.value.map((bar) => bar.adjClose);
      return {
        panel: {
          entity: { id: entity.id, canonicalName: entity.canonicalName, ticker: entity.ticker },
          quote: marketQuote.value,
          indicators: {
            sma50: simpleMovingAverage(closes, 50),
            rsi14: relativeStrengthIndex(closes, 14),
            volatility: volatility(closes),
          },
          series: series.value,
        } satisfies StoryMarket,
        unavailable: false,
      };
    }),
  );
  const market = results.flatMap(({ panel }) => (panel ? [panel] : []));
  return {
    market: market.length > 0 ? market : null,
    status: market.length > 0 ? "ready" : results.some(({ unavailable }) => unavailable) ? "unavailable" : "empty",
    total: entities[0].total,
  };
}
