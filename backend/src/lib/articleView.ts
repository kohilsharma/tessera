import { Article } from "../entities/Article";

// The Article projection shared by the Story detail's article list and the
// Article detail endpoint. Deliberately excludes analysisText: only the detail
// endpoint serves body text, and only through the Publisher's Terms Class gate
// (mayServeText, #40).
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
