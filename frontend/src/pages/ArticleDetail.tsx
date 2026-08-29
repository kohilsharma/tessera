import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getArticle } from "../api/client";
import { PendingState, RetryableError } from "../components/uiStates";

export default function ArticleDetail() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ["article", id], queryFn: () => getArticle(id!), enabled: !!id });

  if (query.isPending) return <PendingState>Loading Article…</PendingState>;
  if (query.isError)
    return (
      <RetryableError
        message={`Could not load Article: ${(query.error as Error).message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  const article = query.data;

  return (
    <main>
      <p>
        <Link to={`/stories/${article.story.id}`}>Back to {article.story.title}</Link>
      </p>
      <h1>{article.title}</h1>
      <p>
        {article.publisher.name} · {new Date(article.publishedAt).toLocaleDateString()} ·{" "}
        <a href={article.url} target="_blank" rel="noreferrer">
          Original source
        </a>
      </p>
      {article.analysisText ? (
        <p>{article.analysisText}</p>
      ) : (
        <p>
          This Article&rsquo;s text is held for analysis only and is not shown here (
          {article.analysisTextMode}). Read it at the original source above.
        </p>
      )}
    </main>
  );
}
