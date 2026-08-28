import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { search, isStoryCategory, STORY_CATEGORIES, type SearchSortField } from "../api/client";

// URL search params double as the query/filter/sort/page state, same convention
// as Stories — shareable links, and back/forward behaves as expected.
// ponytail: updateFilter/clearFilters/goToPage and the filter-form JSX below
// are near-duplicates of Stories.tsx's — a second real consumer now exists, so
// a shared useListQueryParams hook would pay for itself; deferred since this
// ticket doesn't touch Stories.tsx, extract when a third list page needs it.
export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const rawCategory = searchParams.get("category") ?? "";
  const category = isStoryCategory(rawCategory) ? rawCategory : "";
  const [rawSortField, rawSortDir] = (searchParams.get("sort") ?? "").split(":");
  const sortField: SearchSortField = rawSortField === "publishedAt" ? "publishedAt" : "relevance";
  const sortDir = rawSortDir === "asc" ? "asc" : "desc";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const hasFilters = Boolean(category || dateFrom || dateTo);

  const query = useQuery({
    queryKey: ["search", { q, category, sortField, sortDir, dateFrom, dateTo, page }],
    queryFn: () =>
      search({
        q,
        category: category || undefined,
        sort: `${sortField}:${sortDir}`,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
      }),
    enabled: q.trim().length > 0,
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
    next.set("q", q);
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
      <h1>Search</h1>
      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Search{" "}
          <input
            type="search"
            value={q}
            placeholder="Search Articles…"
            onChange={(e) => updateFilter("q", e.target.value)}
          />
        </label>{" "}
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
            <option value="relevance">Relevance</option>
            <option value="publishedAt">Date published</option>
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
          Published from{" "}
          <input type="date" value={dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} />
        </label>{" "}
        <label>
          to <input type="date" value={dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} />
        </label>
      </form>

      {!q.trim() && <p>Enter a search term to find Articles across the corpus.</p>}
      {query.isPending && q.trim() && <p role="status">Searching…</p>}
      {query.isError && (
        <div role="alert">
          <p>Could not run this search: {(query.error as Error).message}</p>
          <button type="button" onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <div>
          <p>No Articles match &ldquo;{q}&rdquo;.</p>
          {hasFilters && (
            <button type="button" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <ul>
            {query.data.items.map((article) => (
              <li key={article.id}>
                <Link to={`/articles/${article.id}`}>{article.title}</Link> — {article.publisher.name} ·{" "}
                {new Date(article.publishedAt).toLocaleDateString()} ·{" "}
                <Link to={`/stories/${article.story.id}`}>{article.story.title}</Link>
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
