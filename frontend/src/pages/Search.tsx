import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { search, type SearchSortField } from "../api/client";
import {
  CategoryFilter,
  DateRangeFilter,
  Pagination,
  SortDirectionFilter,
  useListQueryParams,
} from "../components/listControls";
import { EmptyState, EntryList, PendingState, RetryableError } from "../components/uiStates";

export default function Search() {
  // "q" survives Clear filters: clearing the category on a search must not also
  // throw away the term the results are for.
  const list = useListQueryParams(["q", "sort"]);
  const q = list.get("q");
  const sortField: SearchSortField = list.sortField === "publishedAt" ? "publishedAt" : "relevance";

  const query = useQuery({
    queryKey: ["search", { ...list, q, sortField }],
    queryFn: () =>
      search({
        q,
        category: list.category || undefined,
        sort: `${sortField}:${list.sortDir}`,
        dateFrom: list.dateFrom || undefined,
        dateTo: list.dateTo || undefined,
        page: list.page,
      }),
    enabled: q.trim().length > 0,
  });

  return (
    <main>
      <h1>Search</h1>
      <form onSubmit={(e) => e.preventDefault()}>
        <label className="filter-field">
          Search{" "}
          <input
            type="search"
            value={q}
            placeholder="Search Articles…"
            onChange={(e) => list.updateFilter("q", e.target.value)}
          />
        </label>{" "}
        <CategoryFilter value={list.category} onChange={(value) => list.updateFilter("category", value)} />{" "}
        <label className="filter-field">
          Sort by{" "}
          <select
            value={sortField}
            onChange={(e) => list.updateFilter("sort", `${e.target.value}:${list.sortDir}`)}
          >
            <option value="relevance">Relevance</option>
            <option value="publishedAt">Date published</option>
          </select>
        </label>{" "}
        <SortDirectionFilter
          value={list.sortDir}
          onChange={(value) => list.updateFilter("sort", `${sortField}:${value}`)}
        />{" "}
        <DateRangeFilter
          label="Published from"
          from={list.dateFrom}
          to={list.dateTo}
          onChange={list.updateFilter}
        />
      </form>

      {!q.trim() && <EmptyState>Enter a search term to find Articles across the corpus.</EmptyState>}
      {query.isPending && q.trim() && <PendingState>Searching…</PendingState>}
      {query.isError && (
        <RetryableError
          message={`Could not run this search: ${(query.error as Error).message}`}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState>
          <p>No Articles match &ldquo;{q}&rdquo;.</p>
          {list.hasFilters && (
            <button type="button" onClick={list.clearFilters}>
              Clear filters
            </button>
          )}
        </EmptyState>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <EntryList>
            {query.data.items.map((article) => (
              <li key={article.id}>
                <Link to={`/articles/${article.id}`}>{article.title}</Link> — {article.publisher.name} ·{" "}
                {new Date(article.publishedAt).toLocaleDateString()} ·{" "}
                <Link to={`/stories/${article.story.id}`}>{article.story.title}</Link>
              </li>
            ))}
          </EntryList>
          <Pagination
            page={query.data.page}
            totalPages={query.data.totalPages}
            total={query.data.total}
            onGoToPage={list.goToPage}
          />
        </>
      )}
    </main>
  );
}
