import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getBriefs, type BriefSortField } from "../api/client";
import { BriefCoverThumbnail } from "../components/coverImage";
import { Entry, EntryRegister, FilterRegister, IndexPage } from "../components/indexArchetype";
import {
  CategoryFilter,
  DateRangeFilter,
  SortDirectionFilter,
  SortFieldFilter,
  useListQueryParams,
} from "../components/listControls";
import { EmptyState, PendingState, RetryableError } from "../components/uiStates";

// Story 34's advanced controls, now on the Index archetype (#32): the owned list
// reads in the same vocabulary as the corpus it draws from, so a reader learns
// one layout. The only thing a Brief entry has that a Story's doesn't is its
// cover plate — always drawn, so the register doesn't step in and out as it
// scrolls past Briefs with and without an image.
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
    <IndexPage
      title="My Briefs"
      action={
        <Link className="index-action" to="/briefs/new">
          New Brief
        </Link>
      }
    >
      <FilterRegister label="Filter your Briefs">
        <CategoryFilter value={list.category} onChange={(value) => list.updateFilter("category", value)} />{" "}
        <SortFieldFilter
          value={sortField}
          options={[
            { value: "createdAt", label: "Date created" },
            { value: "updatedAt", label: "Last updated" },
            { value: "title", label: "Title" },
          ]}
          onChange={(value) => list.updateFilter("sort", `${value}:${list.sortDir}`)}
        />{" "}
        <SortDirectionFilter
          value={list.sortDir}
          onChange={(value) => list.updateFilter("sort", `${sortField}:${value}`)}
        />{" "}
        <DateRangeFilter label="Created from" from={list.dateFrom} to={list.dateTo} onChange={list.updateFilter} />
      </FilterRegister>

      {query.isPending && <PendingState>Loading your Briefs…</PendingState>}
      {query.isError && (
        <RetryableError
          message={`Could not load Briefs: ${(query.error as Error).message}`}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      )}
      {/* The same two empty states Stories keeps apart: filters that matched
          nothing are the owner's to undo, an owner with no Briefs yet has
          nothing to clear and wants the way to their first one. */}
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
        <EntryRegister envelope={query.data} onGoToPage={list.goToPage}>
          {query.data.items.map((brief) => (
            <Entry
              key={brief.id}
              to={`/briefs/${brief.id}`}
              title={brief.title}
              cover={<BriefCoverThumbnail url={brief.coverImageUrl} cacheKey={brief.coverImageKey} />}
              meta={[
                { term: "Category", value: brief.category },
                {
                  term: "Capacity",
                  value: `${brief.articleCount}/${brief.articleCapacityLimit} article${
                    brief.articleCapacityLimit === 1 ? "" : "s"
                  }`,
                },
                {
                  term: "Created",
                  value: <time dateTime={brief.createdAt}>{new Date(brief.createdAt).toLocaleDateString()}</time>,
                },
              ]}
            />
          ))}
        </EntryRegister>
      )}
    </IndexPage>
  );
}
