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

// Fixed policy beneath the one calibration knob: borderline assignments are
// proposals for an Admin, not another operator-tuned clustering decision.
export const REVIEW_THRESHOLD = Math.max(0, SIMILARITY_THRESHOLD - 0.1);

// Time is a hard gate rather than a weighted score component.
export const RECENCY_WINDOW_HOURS = envNumber("CLUSTERING_RECENCY_WINDOW_HOURS", 72, { min: 1, max: 24 * 365 });

// Request payload bound only, and not ADR-0026's third tunable: it bounds one request
// to the embedding provider (ADR-0025 counts requests, so a run batches), a run drains
// every eligible Article whatever it is set to, and no value changes a membership
// decision.
export const EMBED_BATCH_SIZE = envNumber("CLUSTERING_EMBED_BATCH_SIZE", 32, { min: 1, max: 256 });

export const CLUSTERABLE_TEXT_MODES: AnalysisTextMode[] = ["feed_excerpt", "api_content", "licensed_full_text"];

// What a Story is called when the naming call does not answer usefully (#51): the
// medoid's own title, and the broadest category in the vocabulary.
export const DEFAULT_STORY_CATEGORY: StoryCategory = "world";

// One small call per new Story. Bounded rather than tunable: past this the medoid
// title is the better answer, because the run behind it is holding the queue.
export const STORY_NAMING_TIMEOUT_MS = 15_000;

// Shared with the Mock so its deterministic answer always passes naming validation.
export const STORY_NAME_MAX_LENGTH = 120;
