import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getStories, type StorySortField } from "../api/client";
import {
  CategoryFilter,
  DateRangeFilter,
  Pagination,
  SortDirectionFilter,
  useListQueryParams,
} from "../components/listControls";
import { EmptyState, EntryList, PendingState, RetryableError } from "../components/uiStates";

export default function Stories() {
  const list = useListQueryParams();
  const sortField: StorySortField = list.sortField === "title" ? "title" : "firstSeenAt";

  const query = useQuery({
    queryKey: ["stories", { ...list, sortField }],
    queryFn: () =>
      getStories({
        category: list.category || undefined,
        sort: `${sortField}:${list.sortDir}`,
        dateFrom: list.dateFrom || undefined,
        dateTo: list.dateTo || undefined,
        page: list.page,
      }),
  });

  return (
    <main>
      <h1>Stories</h1>
      <form onSubmit={(e) => e.preventDefault()}>
        <CategoryFilter value={list.category} onChange={(value) => list.updateFilter("category", value)} />{" "}
        <label className="filter-field">
          Sort by{" "}
          <select
            value={sortField}
            onChange={(e) => list.updateFilter("sort", `${e.target.value}:${list.sortDir}`)}
          >
            <option value="firstSeenAt">Date first seen</option>
            <option value="title">Title</option>
          </select>
        </label>{" "}
        <SortDirectionFilter
          value={list.sortDir}
          onChange={(value) => list.updateFilter("sort", `${sortField}:${value}`)}
        />{" "}
        <DateRangeFilter
          label="First seen from"
          from={list.dateFrom}
          to={list.dateTo}
          onChange={list.updateFilter}
        />
      </form>

      {query.isPending && <PendingState>Loading Stories…</PendingState>}
      {query.isError && (
        <RetryableError
          message={`Could not load Stories: ${(query.error as Error).message}`}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState>
          <p>No Stories match these filters.</p>
          {list.hasFilters ? (
            <button type="button" onClick={list.clearFilters}>
              Clear filters
            </button>
          ) : (
            <p>
              The corpus is empty — run <code>npm run seed</code> in <code>backend/</code> to load the demo Stories.
            </p>
          )}
        </EmptyState>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <EntryList>
            {query.data.items.map((story) => (
              <li key={story.id}>
                <Link to={`/stories/${story.id}`}>{story.title}</Link> — {story.category},{" "}
                {story.articleCount} article{story.articleCount === 1 ? "" : "s"}
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
