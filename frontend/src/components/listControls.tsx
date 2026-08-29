import { useSearchParams } from "react-router-dom";
import { isStoryCategory, STORY_CATEGORIES, type StoryCategory } from "../api/client";

// URL search params double as the filter/sort/page state on every list page:
// shareable links, and back/forward behaves the way a reader expects. The names
// mirror the API's list contract (category, dateFrom, dateTo, sort, page) so
// there is one vocabulary from the address bar to the query.
//
// `preserveOnClear` is what "Clear filters" keeps: sort everywhere, plus the
// search term on /search — clearing filters there must not also clear the query.
export function useListQueryParams(preserveOnClear: readonly string[] = ["sort"]) {
  const [searchParams, setSearchParams] = useSearchParams();

  const get = (key: string): string => searchParams.get(key) ?? "";

  const rawCategory = get("category");
  const category: StoryCategory | "" = isStoryCategory(rawCategory) ? rawCategory : "";
  const [sortField, rawSortDir] = get("sort").split(":");
  const sortDir: "asc" | "desc" = rawSortDir === "asc" ? "asc" : "desc";
  const dateFrom = get("dateFrom");
  const dateTo = get("dateTo");
  const page = Number(get("page") || "1") || 1;

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    // A narrower filter can shrink the result set below the current page, which
    // would otherwise land the reader on an empty page 4 of 2.
    next.delete("page");
    setSearchParams(next);
  }

  function clearFilters() {
    const next = new URLSearchParams();
    for (const key of preserveOnClear) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    setSearchParams(next);
  }

  function goToPage(next: number) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(next));
    setSearchParams(params);
  }

  return {
    get,
    category,
    sortField,
    sortDir,
    dateFrom,
    dateTo,
    page,
    hasFilters: Boolean(category || dateFrom || dateTo),
    updateFilter,
    clearFilters,
    goToPage,
  };
}

export function CategoryFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label>
      Category{" "}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {STORY_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SortDirectionFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label>
      Direction{" "}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="desc">Descending</option>
        <option value="asc">Ascending</option>
      </select>
    </label>
  );
}

// `label` because the range means something different per page — Stories filter
// on when a Story was first seen, Briefs on when one was created.
export function DateRangeFilter({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (key: "dateFrom" | "dateTo", value: string) => void;
}) {
  return (
    <>
      <label>
        {label}{" "}
        <input type="date" value={from} onChange={(e) => onChange("dateFrom", e.target.value)} />
      </label>{" "}
      <label>
        to <input type="date" value={to} onChange={(e) => onChange("dateTo", e.target.value)} />
      </label>
    </>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onGoToPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onGoToPage: (page: number) => void;
}) {
  return (
    <>
      <p>
        Page {page} of {totalPages} ({total} total)
      </p>
      <button type="button" disabled={page <= 1} onClick={() => onGoToPage(page - 1)}>
        Previous
      </button>{" "}
      <button type="button" disabled={page >= totalPages} onClick={() => onGoToPage(page + 1)}>
        Next
      </button>
    </>
  );
}

// The error state every data screen shares: say what failed, and offer the one
// action that can recover it.
export function RetryableError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
