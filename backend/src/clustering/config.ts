import type { AnalysisTextMode } from "../entities/Article";
import type { StoryCategory } from "../entities/Story";

// ADR-0026's two tunables, plus the two bounds that keep one run a bounded piece
// of work. Typed constants read from env with documented defaults — no
// SystemConfig table, and nothing here is a magic literal buried in a query.

function envNumber(key: string, fallback: number, { min, max }: { min: number; max: number }): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  // A misread knob is worse than an unset one: silently clamping a typo would run
  // clustering at a threshold nobody chose, and false merges are the release-
  // critical failure (v3 §14.6).
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

// Cosine similarity an Article must reach against a Story's centroid to join it.
// ponytail: one hand-set calibration knob, tuned by eye — there is no eval harness
// until Phase 5 (ADR-0011), which is exactly why ADR-0026 allows only one. Set
// tight rather than generous: a false merge corrupts every claim later synthesised
// from that Story, while a miss only leaves reporting Unclustered until the next
// run. Retune it against the serving embedding model, the way hybridSearch.ts's
// distance cutoff has to be (ADR-0025 — providers are swappable, their score
// distributions are not the same).
export const SIMILARITY_THRESHOLD = envNumber("CLUSTERING_SIMILARITY_THRESHOLD", 0.85, { min: 0, max: 1 });

// Time is a hard gate, not a weighted term (ADR-0026): a Story last seen outside
// this window is not a candidate at any similarity, so an anniversary piece cannot
// join a year-old event. Three days is the span over which a news event is still
// visibly the same event.
export const RECENCY_WINDOW_HOURS = envNumber("CLUSTERING_RECENCY_WINDOW_HOURS", 72, { min: 1, max: 24 * 365 });

// The ceiling on one run's work, applied to both the embedding step and the
// assignment step. Bounds the provider requests a run makes (ADR-0025: hosted
// limits count requests) and the pairwise scan that seeds new Stories. The job
// ticks hourly, so a backlog drains over runs rather than in one.
export const MAX_ARTICLES_PER_RUN = envNumber("CLUSTERING_MAX_ARTICLES_PER_RUN", 200, { min: 1, max: 10_000 });

// Texts per embedding request. Large enough that a run is a handful of requests
// rather than hundreds, small enough to stay under a hosted provider's per-request
// payload limit.
export const EMBED_BATCH_SIZE = envNumber("CLUSTERING_EMBED_BATCH_SIZE", 32, { min: 1, max: 256 });

// ADR-0026: only Articles carrying text are clustered. `metadata_only` rows are
// never considered — they are the firehose metadata the Retention Window exists to
// delete, and title-only similarity is the weakest signal available. Naming the
// clusterable rungs rather than the excluded ones means a new rung has to be
// deliberately admitted.
//
// `manual_fixture` is absent on purpose: that is what closes the Curated Corpus
// (ADR-0007, ADR-0026) from this side.
export const CLUSTERABLE_TEXT_MODES: AnalysisTextMode[] = ["feed_excerpt", "api_content", "licensed_full_text"];

// A newly seeded Story's category until #51's model call names it. `world` is the
// honest default for reporting nothing has categorised: it is the one category
// that asserts no subject beyond "news", where guessing `politics` or `business`
// would put a wrong label on a Story an Investor filters by.
export const DEFAULT_STORY_CATEGORY: StoryCategory = "world";
