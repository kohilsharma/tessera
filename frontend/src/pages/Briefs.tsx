import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getBriefs, type BriefSortField } from "../api/client";
import {
  CategoryFilter,
  DateRangeFilter,
  Pagination,
  SortDirectionFilter,
  useListQueryParams,
} from "../components/listControls";
import { EmptyState, EntryList, PendingState, RetryableError } from "../components/uiStates";

// Story 34: the owned-entity list carries the same advanced controls as the
// corpus lists — filter (category + date range), sort, and pagination.
export default function Briefs() {
  const list = useListQueryParams();
  const sortField: BriefSortField =
    list.sortField === "title" || list.sortField === "updatedAt" ? list.sortField : "createdAt";

  const query = useQuery({
    queryKey: ["briefs", { ...list, sortField }],
    queryFn: () =>
      getBriefs({
        category: list.category || undefined,
        sort: `${sortField}:${list.sortDir}`,
        dateFrom: list.dateFrom || undefined,
        dateTo: list.dateTo || undefined,
        page: list.page,
      }),
  });

  return (
    <main>
      <h1>My Briefs</h1>
      <p>
        <Link to="/briefs/new">+ New Brief</Link>
      </p>
      <form onSubmit={(e) => e.preventDefault()}>
        <CategoryFilter value={list.category} onChange={(value) => list.updateFilter("category", value)} />{" "}
        <label className="filter-field">
          Sort by{" "}
          <select
            value={sortField}
            onChange={(e) => list.updateFilter("sort", `${e.target.value}:${list.sortDir}`)}
          >
            <option value="createdAt">Date created</option>
            <option value="updatedAt">Last updated</option>
            <option value="title">Title</option>
          </select>
        </label>{" "}
        <SortDirectionFilter
          value={list.sortDir}
          onChange={(value) => list.updateFilter("sort", `${sortField}:${value}`)}
        />{" "}
        <DateRangeFilter label="Created from" from={list.dateFrom} to={list.dateTo} onChange={list.updateFilter} />
      </form>

      {query.isPending && <PendingState>Loading your Briefs…</PendingState>}
      {query.isError && (
        <RetryableError
          message={`Could not load Briefs: ${(query.error as Error).message}`}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      )}
      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState>
          {list.hasFilters ? (
            <>
              <p>No Briefs match these filters.</p>
              <button type="button" onClick={list.clearFilters}>
                Clear filters
              </button>
            </>
          ) : (
            <p>
              You have no Briefs yet. <Link to="/briefs/new">Create one</Link>.
            </p>
          )}
        </EmptyState>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <EntryList>
            {query.data.items.map((brief) => (
              <li key={brief.id}>
                <Link to={`/briefs/${brief.id}`}>{brief.title}</Link> — {brief.category}, {brief.articleCount}/
                {brief.articleCapacityLimit} article{brief.articleCapacityLimit === 1 ? "" : "s"}
              </li>
            ))}
          </EntryList>
          <Pagination envelope={query.data} onGoToPage={list.goToPage} />
        </>
      )}
    </main>
  );
}
