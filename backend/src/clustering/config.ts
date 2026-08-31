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

// Time is a hard gate rather than a weighted score component.
export const RECENCY_WINDOW_HOURS = envNumber("CLUSTERING_RECENCY_WINDOW_HOURS", 72, { min: 1, max: 24 * 365 });

// Request payload bound only; a run still drains every eligible Article.
export const EMBED_BATCH_SIZE = envNumber("CLUSTERING_EMBED_BATCH_SIZE", 32, { min: 1, max: 256 });

export const CLUSTERABLE_TEXT_MODES: AnalysisTextMode[] = ["feed_excerpt", "api_content", "licensed_full_text"];

// Honest fallback until #51 names and categorises a Story.
export const DEFAULT_STORY_CATEGORY: StoryCategory = "world";
