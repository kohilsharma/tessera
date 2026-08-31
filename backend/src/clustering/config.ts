import type { AnalysisTextMode } from "../entities/Article";
import type { StoryCategory } from "../entities/Story";

function envNumber(key: string, fallback: number, { min, max }: { min: number; max: number }): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

// ADR-0026's only calibration knob. Err tight: false merges corrupt later
// synthesis while misses remain Unclustered for the next run.
export const SIMILARITY_THRESHOLD = envNumber("CLUSTERING_SIMILARITY_THRESHOLD", 0.85, { min: 0, max: 1 });

// The floor of the review band (#50). An assignment scoring between this and the
// threshold above is a *proposal* held for an Admin (CONTEXT.md "Story
// Assignment"); below it the Article stays Unclustered and is reconsidered next
// run. Not a second calibration knob in the sense the threshold is: erring wide
// here costs an Admin some reading, not a corrupted Story, because a held
// assignment reaches no reader and grounds no claim until someone accepts it.
export const REVIEW_THRESHOLD = envNumber("CLUSTERING_REVIEW_THRESHOLD", 0.75, { min: 0, max: 1 });

// A band with its floor above its ceiling is not a tighter configuration, it is a
// pair of numbers that cannot both be honoured — refuse it at load rather than
// silently making every proposal auto-accepted. Equal is legal: it closes the
// band, which is the pre-#50 behaviour.
if (REVIEW_THRESHOLD > SIMILARITY_THRESHOLD) {
  throw new Error(
    `CLUSTERING_REVIEW_THRESHOLD (${REVIEW_THRESHOLD}) must not exceed ` +
      `CLUSTERING_SIMILARITY_THRESHOLD (${SIMILARITY_THRESHOLD}) — the review band sits beneath the auto-accept threshold`,
  );
}

// Time is a hard gate rather than a weighted score component.
export const RECENCY_WINDOW_HOURS = envNumber("CLUSTERING_RECENCY_WINDOW_HOURS", 72, { min: 1, max: 24 * 365 });

// Request payload bound only; a run still drains every eligible Article.
export const EMBED_BATCH_SIZE = envNumber("CLUSTERING_EMBED_BATCH_SIZE", 32, { min: 1, max: 256 });

export const CLUSTERABLE_TEXT_MODES: AnalysisTextMode[] = ["feed_excerpt", "api_content", "licensed_full_text"];

// Honest fallback until #51 names and categorises a Story.
export const DEFAULT_STORY_CATEGORY: StoryCategory = "world";
