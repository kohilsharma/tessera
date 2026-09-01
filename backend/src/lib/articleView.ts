import type { Article } from "../entities/Article";
import type { Publisher } from "../entities/Publisher";

// What the projection reads, rather than the whole row it is usually read off: a
// caller holding only these fields — the timeline seam's own tests build a set by
// hand — states them instead of casting a partial object to an Article. Every
// caller passing a real row still typechecks; this only widens what may be passed.
export type ArticleProjection = Pick<Article, "id" | "title" | "url" | "publishedAt" | "analysisTextMode"> & {
  publisher: Pick<Publisher, "id" | "name" | "domain">;
};

// The Article projection shared by the Story detail's article list and the
// Article detail endpoint. Deliberately excludes analysisText: only the detail
// endpoint serves body text, and only through the Publisher's Terms Class gate
// (mayServeText, #40).
export function toPublicArticle(article: ArticleProjection) {
  return {
    id: article.id,
    title: article.title,
    url: article.url,
    publishedAt: article.publishedAt,
    analysisTextMode: article.analysisTextMode,
    publisher: { id: article.publisher.id, name: article.publisher.name, domain: article.publisher.domain },
  };
}
