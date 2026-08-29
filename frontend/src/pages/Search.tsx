import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { search, type SearchSortField } from "../api/client";
import { Entry, EntryRegister, FilterRegister, IndexPage } from "../components/indexArchetype";
import {
  CategoryFilter,
  DateRangeFilter,
  SortDirectionFilter,
  SortFieldFilter,
  useListQueryParams,
} from "../components/listControls";
import { EmptyState, PendingState, RetryableError } from "../components/uiStates";

// The third page on the Index archetype (#32). A result is an Article in the
// corpus, so it is registered like one: its Publisher and its Story in the
// ledger, not trailed after the title as prose.
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
    <IndexPage title="Search">
      {/* The term sits in the register with the filters — it is the one control
          that is not a filter (it is what the results are *of*), which is why it
          never wears the applied pill and why clearing filters keeps it. */}
      <FilterRegister label="Search and filter Articles">
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
        <SortFieldFilter
          value={sortField}
          options={[
            { value: "relevance", label: "Relevance" },
            { value: "publishedAt", label: "Date published" },
          ]}
          onChange={(value) => list.updateFilter("sort", `${value}:${list.sortDir}`)}
        />{" "}
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
      </FilterRegister>

      {/* Three empty states, all distinct: nothing asked for yet, a term that
          matched nothing, and a term whose filters matched nothing. */}
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
        <EntryRegister envelope={query.data} onGoToPage={list.goToPage}>
          {query.data.items.map((article) => (
            <Entry
              key={article.id}
              to={`/articles/${article.id}`}
              title={article.title}
              meta={[
                { term: "Publisher", value: article.publisher.name },
                {
                  term: "Story",
                  value: <Link to={`/stories/${article.story.id}`}>{article.story.title}</Link>,
                },
                {
                  term: "Published",
                  value: (
                    <time dateTime={article.publishedAt}>
                      {new Date(article.publishedAt).toLocaleDateString()}
                    </time>
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
