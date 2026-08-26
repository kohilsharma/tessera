import { Article } from "../entities/Article";
import type { AnalysisTextMode } from "../entities/Article";

// ADR-0018 / AGENTS.md core invariant: article bodies are internal only, never
// redistributed. Until Publisher carries per-source rights (`terms_class` lands
// with ingestion in Phase 2, ADR-0022), the Article's own Analysis Text Mode is
// the only rights signal we have — so text leaves the API only for the modes
// that are ours to serve: our own synthetic fixtures, and the excerpts
// publishers syndicate for exactly this purpose. `api_content` and
// `licensed_full_text` stay internal (embeddings and analysis only).
// ponytail: mode allowlist, not a real rights check — swap the predicate for
// Publisher.terms_class once ingestion populates it.
const REDISTRIBUTABLE_MODES: readonly AnalysisTextMode[] = ["manual_fixture", "feed_excerpt"];

export function mayRedistribute(mode: AnalysisTextMode): boolean {
  return REDISTRIBUTABLE_MODES.includes(mode);
}

// The Article projection shared by the Story detail's article list and the
// Article detail endpoint. Deliberately excludes analysisText: only the detail
// endpoint serves body text, and only through the gate above.
export function toPublicArticle(article: Article) {
  return {
    id: article.id,
    title: article.title,
    url: article.url,
    publishedAt: article.publishedAt,
    analysisTextType: article.analysisTextType,
    publisher: { id: article.publisher.id, name: article.publisher.name, domain: article.publisher.domain },
  };
}
