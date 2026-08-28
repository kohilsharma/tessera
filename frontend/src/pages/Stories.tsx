import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { getStories, isStoryCategory, STORY_CATEGORIES, type StorySortField } from "../api/client";

// URL search params double as the filter/sort/page state: shareable links,
// and back/forward behaves the way a reader expects on a list page. The names
// mirror the API's list contract (category, dateFrom, dateTo, sort, page) so
// there is one vocabulary from the address bar to the query.
export default function Stories() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawCategory = searchParams.get("category") ?? "";
  const category = isStoryCategory(rawCategory) ? rawCategory : "";
  const [rawSortField, rawSortDir] = (searchParams.get("sort") ?? "").split(":");
  const sortField: StorySortField = rawSortField === "title" ? "title" : "firstSeenAt";
  const sortDir = rawSortDir === "asc" ? "asc" : "desc";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const hasFilters = Boolean(category || dateFrom || dateTo);

  const query = useQuery({
    queryKey: ["stories", { category, sortField, sortDir, dateFrom, dateTo, page }],
    queryFn: () =>
      getStories({
        category: category || undefined,
        sort: `${sortField}:${sortDir}`,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
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

  function clearFilters() {
    const next = new URLSearchParams();
    const sort = searchParams.get("sort");
    if (sort) next.set("sort", sort);
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
          <select value={sortField} onChange={(e) => updateFilter("sort", `${e.target.value}:${sortDir}`)}>
            <option value="firstSeenAt">Date first seen</option>
            <option value="title">Title</option>
          </select>
        </label>{" "}
        <label>
          Direction{" "}
          <select value={sortDir} onChange={(e) => updateFilter("sort", `${sortField}:${e.target.value}`)}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>{" "}
        <label>
          First seen from{" "}
          <input type="date" value={dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} />
        </label>{" "}
        <label>
          to <input type="date" value={dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} />
        </label>
      </form>

      {query.isPending && <p role="status">Loading Stories…</p>}
      {query.isError && (
        <div role="alert">
          <p>Could not load Stories: {(query.error as Error).message}</p>
          <button type="button" onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <div>
          <p>No Stories match these filters.</p>
          {hasFilters ? (
            <button type="button" onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            <p>
              The corpus is empty — run <code>npm run seed</code> in <code>backend/</code> to load the demo Stories.
            </p>
          )}
        </div>
      )}
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
