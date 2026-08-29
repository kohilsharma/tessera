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

// Applied filters read differently from unapplied ones, and not by colour alone:
// `.filter-field--applied` fills the pill with ink and weights its value, so the
// distinction survives greyscale. Derived from the value the control already
// receives, so no page passes anything new.
//
// The register also holds two controls that never enter the applied state: sort,
// which always has a value and never narrows the result set, and Search's term,
// which is what the results are *of* rather than a filter on them — which is why
// clearing filters keeps it. Those wear a plain `.filter-field`.
const filterFieldClass = (applied: boolean) =>
  applied ? "filter-field filter-field--applied" : "filter-field";

export function CategoryFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className={filterFieldClass(Boolean(value))}>
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

// Sort shares the register's pill, but never its applied state — see
// filterFieldClass.
export function SortDirectionFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="filter-field">
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
      <label className={filterFieldClass(Boolean(from))}>
        {label}{" "}
        <input type="date" value={from} onChange={(e) => onChange("dateFrom", e.target.value)} />
      </label>{" "}
      <label className={filterFieldClass(Boolean(to))}>
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
    <div className="pagination">
      <p>
        Page {page} of {totalPages} ({total} total)
      </p>
      <button type="button" disabled={page <= 1} onClick={() => onGoToPage(page - 1)}>
        Previous
      </button>{" "}
      <button type="button" disabled={page >= totalPages} onClick={() => onGoToPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
