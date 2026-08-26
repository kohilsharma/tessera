import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getArticle } from "../api/client";

export default function ArticleDetail() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ["article", id], queryFn: () => getArticle(id!), enabled: !!id });

  if (query.isPending) return <p role="status">Loading Article…</p>;
  if (query.isError) return <p role="alert">Could not load Article: {(query.error as Error).message}</p>;

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
      <p>{article.analysisText}</p>
    </main>
  );
}
