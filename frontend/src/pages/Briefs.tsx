import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { getBriefs, STORY_CATEGORIES, type BriefSortField, type StoryCategory } from "../api/client";

function isStoryCategory(value: string): value is StoryCategory {
  return (STORY_CATEGORIES as readonly string[]).includes(value);
}

// Mirrors src/pages/Stories.tsx's URL-as-state pattern, filtered server-side to
// the caller's own Briefs (see backend/src/routes/briefs.ts).
export default function Briefs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawCategory = searchParams.get("category") ?? "";
  const category = isStoryCategory(rawCategory) ? rawCategory : "";
  const [rawSortField, rawSortDir] = (searchParams.get("sort") ?? "").split(":");
  const sortField: BriefSortField = rawSortField === "title" ? "title" : "createdAt";
  const sortDir = rawSortDir === "asc" ? "asc" : "desc";
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const query = useQuery({
    queryKey: ["briefs", { category, sortField, sortDir, page }],
    queryFn: () => getBriefs({ category: category || undefined, sort: `${sortField}:${sortDir}`, page }),
  });

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setSearchParams(next);
  }

  function goToPage(next: number) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(next));
    setSearchParams(params);
  }

  return (
    <main>
      <h1>My Briefs</h1>
      <p>
        <Link to="/briefs/new">+ New Brief</Link>
      </p>
      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Category{" "}
          <select value={category} onChange={(e) => updateFilter("category", e.target.value)}>
            <option value="">All</option>
            {STORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Sort by{" "}
          <select value={sortField} onChange={(e) => updateFilter("sort", `${e.target.value}:${sortDir}`)}>
            <option value="createdAt">Date created</option>
            <option value="title">Title</option>
          </select>
        </label>{" "}
        <label>
          Direction{" "}
          <select value={sortDir} onChange={(e) => updateFilter("sort", `${sortField}:${e.target.value}`)}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
      </form>

      {query.isPending && <p role="status">Loading your Briefs…</p>}
      {query.isError && (
        <div role="alert">
          <p>Could not load Briefs: {(query.error as Error).message}</p>
          <button type="button" onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <p>
          {category ? "No Briefs match this filter." : "You have no Briefs yet."}{" "}
          <Link to="/briefs/new">Create one</Link>.
        </p>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <ul>
            {query.data.items.map((brief) => (
              <li key={brief.id}>
                <Link to={`/briefs/${brief.id}`}>{brief.title}</Link> — {brief.category}, {brief.articleCount}/
                {brief.articleCapacityLimit} article{brief.articleCapacityLimit === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
          <p>
            Page {query.data.page} of {query.data.totalPages} ({query.data.total} total)
          </p>
          <button type="button" disabled={query.data.page <= 1} onClick={() => goToPage(query.data.page - 1)}>
            Previous
          </button>{" "}
          <button
            type="button"
            disabled={query.data.page >= query.data.totalPages}
            onClick={() => goToPage(query.data.page + 1)}
          >
            Next
          </button>
        </>
      )}
    </main>
  );
}
