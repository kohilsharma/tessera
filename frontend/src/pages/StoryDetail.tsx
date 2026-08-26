import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getStory } from "../api/client";

export default function StoryDetail() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ["story", id], queryFn: () => getStory(id!), enabled: !!id });

  if (query.isPending) return <p role="status">Loading Story…</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>Could not load Story: {(query.error as Error).message}</p>
        <button type="button" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    );

  const story = query.data;

  return (
    <main>
      <p>
        <Link to="/stories">Back to Stories</Link>
      </p>
      <h1>{story.title}</h1>
      <p>
        {story.category} · first seen {new Date(story.firstSeenAt).toLocaleDateString()}
      </p>
      {story.summary && <p>{story.summary}</p>}

      <h2>Articles</h2>
      {story.articles.length === 0 ? (
        <p>No Articles yet.</p>
      ) : (
        <ul>
          {story.articles.map((article) => (
            <li key={article.id}>
              <Link to={`/articles/${article.id}`}>{article.title}</Link> — {article.publisher.name},{" "}
              {new Date(article.publishedAt).toLocaleDateString()}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
