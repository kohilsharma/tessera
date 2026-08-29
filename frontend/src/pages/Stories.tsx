import { useQuery } from "@tanstack/react-query";
import { getStories, type StorySortField } from "../api/client";
import { Entry, EntryRegister, FilterRegister, IndexPage } from "../components/indexArchetype";
import {
  CategoryFilter,
  DateRangeFilter,
  SortDirectionFilter,
  SortFieldFilter,
  useListQueryParams,
} from "../components/listControls";
import { EmptyState, PendingState, RetryableError } from "../components/uiStates";

// The first page on the Index archetype (#31): filter register, ruled entries,
// pagination. Everything shaped here is shared — see components/indexArchetype.
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
    <IndexPage title="Stories">
      <FilterRegister label="Filter Stories">
        <CategoryFilter value={list.category} onChange={(value) => list.updateFilter("category", value)} />{" "}
        <SortFieldFilter
          value={sortField}
          options={[
            { value: "firstSeenAt", label: "Date first seen" },
            { value: "title", label: "Title" },
          ]}
          onChange={(value) => list.updateFilter("sort", `${value}:${list.sortDir}`)}
        />{" "}
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
      </FilterRegister>

      {query.isPending && <PendingState>Loading Stories…</PendingState>}
      {query.isError && (
        <RetryableError
          message={`Could not load Stories: ${(query.error as Error).message}`}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      )}
      {/* Two empty states, kept apart: filters that matched nothing are the
          reader's to undo, an unseeded corpus is not. Saying "no Stories match
          these filters" with no filters applied would misdescribe the cause. */}
      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState>
          {list.hasFilters ? (
            <>
              <p>No Stories match these filters.</p>
              <button type="button" onClick={list.clearFilters}>
                Clear filters
              </button>
            </>
          ) : (
            <p>
              The corpus is empty — run <code>npm run seed</code> in <code>backend/</code> to load the demo
              Stories.
            </p>
          )}
        </EmptyState>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <EntryRegister envelope={query.data} onGoToPage={list.goToPage}>
          {query.data.items.map((story) => (
            <Entry
              key={story.id}
              to={`/stories/${story.id}`}
              title={story.title}
              meta={[
                { term: "Category", value: story.category },
                {
                  term: "Coverage",
                  value: `${story.articleCount} article${story.articleCount === 1 ? "" : "s"}`,
                },
                {
                  term: "First seen",
                  value: (
                    <time dateTime={story.firstSeenAt}>{new Date(story.firstSeenAt).toLocaleDateString()}</time>
                  ),
                },
              ]}
            />
          ))}
        </EntryRegister>
      )}
    </IndexPage>
  );
}
