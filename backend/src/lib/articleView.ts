import { Article } from "../entities/Article";
import type { AnalysisTextMode } from "../entities/Article";

// Until #40 adds Publisher Terms Class, fail closed: only our synthetic fixture
// text leaves the API. Live feed/API/licensed text remains internal even when a
// future clustering run makes its Article public.
export function mayRedistribute(mode: AnalysisTextMode): boolean {
  return mode === "manual_fixture";
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
    analysisTextMode: article.analysisTextMode,
    publisher: { id: article.publisher.id, name: article.publisher.name, domain: article.publisher.domain },
  };
}
