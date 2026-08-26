import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { getStories, STORY_CATEGORIES, type StoryCategory } from "../api/client";

function isStoryCategory(value: string): value is StoryCategory {
  return (STORY_CATEGORIES as readonly string[]).includes(value);
}

// URL search params double as the filter/sort/page state: shareable links,
// and back/forward behaves the way a reader expects on a list page.
export default function Stories() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawCategory = searchParams.get("category") ?? "";
  const category = isStoryCategory(rawCategory) ? rawCategory : "";
  const sortBy = searchParams.get("sortBy") === "title" ? "title" : "firstSeenAt";
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const query = useQuery({
    queryKey: ["stories", { category, sortBy, sortDir, from, to, page }],
    queryFn: () =>
      getStories({
        category: category || undefined,
        sortBy,
        sortDir,
        from: from || undefined,
        to: to || undefined,
        page,
      }),
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
      <h1>Stories</h1>
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
          <select value={sortBy} onChange={(e) => updateFilter("sortBy", e.target.value)}>
            <option value="firstSeenAt">Date first seen</option>
            <option value="title">Title</option>
          </select>
        </label>{" "}
        <label>
          Direction{" "}
          <select value={sortDir} onChange={(e) => updateFilter("sortDir", e.target.value)}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>{" "}
        <label>
          First seen from{" "}
          <input type="date" value={from} onChange={(e) => updateFilter("from", e.target.value)} />
        </label>{" "}
        <label>
          to <input type="date" value={to} onChange={(e) => updateFilter("to", e.target.value)} />
        </label>
      </form>

      {query.isPending && <p role="status">Loading Stories…</p>}
      {query.isError && <p role="alert">Could not load Stories: {(query.error as Error).message}</p>}
      {query.isSuccess && query.data.items.length === 0 && <p>No Stories match these filters.</p>}
      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <ul>
            {query.data.items.map((story) => (
              <li key={story.id}>
                <Link to={`/stories/${story.id}`}>{story.title}</Link> — {story.category},{" "}
                {story.articleCount} article{story.articleCount === 1 ? "" : "s"}
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
