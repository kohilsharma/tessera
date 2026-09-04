import type { PublisherLeaning } from "../entities/Publisher";
import { leaningBandFor } from "./publisherLeaning";

export type CoverageBand = "left" | "centre" | "right";

export type CoverageSpectrum = {
  left: number;
  centre: number;
  right: number;
  unrated: number;
  total: number;
  blindspot: CoverageBand | null;
};

const BLINDSPOT_SHARE = 0.8;

export function buildCoverageSpectrum(
  articles: Array<{ publisher: { leaning: PublisherLeaning | null } }>,
): CoverageSpectrum {
  const spectrum = { left: 0, centre: 0, right: 0, unrated: 0 };
  for (const article of articles) {
    const leaning = article.publisher.leaning;
    if (!leaning) spectrum.unrated += 1;
    else spectrum[leaningBandFor(leaning)] += 1;
  }

  const ratedTotal = spectrum.left + spectrum.centre + spectrum.right;
  const dominant = (["left", "centre", "right"] as const)
    .map((band) => [band, spectrum[band]] as const)
    .sort(([, a], [, b]) => b - a)[0];

  return {
    ...spectrum,
    total: articles.length,
    // A blindspot needs enough rated reporting to say something about the mix;
    // a mostly-unrated Story is an evidence gap, not a political finding.
    blindspot:
      ratedTotal >= 2 &&
      ratedTotal / articles.length >= 0.5 &&
      (dominant[0] === "left" || dominant[0] === "right") &&
      dominant[1] / ratedTotal >= BLINDSPOT_SHARE
        ? dominant[0]
        : null,
  };
}
