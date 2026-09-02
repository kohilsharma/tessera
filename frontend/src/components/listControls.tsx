import { useSearchParams } from "react-router-dom";
import { isStoryCategory, STORY_CATEGORIES, type ListEnvelope, type StoryCategory, type ThemeFacet } from "../api/client";

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
    // The current state as a query string, so a page can hand the same query to a sibling
    // reading of it — /search and its timeline (#65) — rather than making the reader type
    // it twice. Passed whole, params the other reading ignores included: both accept the
    // same vocabulary, and dropping one here would silently lose a filter.
    queryString: searchParams.toString(),
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

// The term the results are *of*, rather than a filter on them — which is why it wears a plain
// pill and why clearing filters keeps it (above). One component because both readings of a
// search carry the same control: the ranked list and its timeline (#65).
export function SearchTermFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="filter-field">
      Search{" "}
      <input
        type="search"
        value={value}
        placeholder="Search Articles…"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

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

// The Theme a neighbourhood is narrowed by (#69). Same pill as every other filter, and a
// filter is all a Theme ever is: ADR-0028 keeps Themes out of the graph as nodes, because ~48
// per Article makes theme-to-theme co-occurrence a complete graph that says nothing.
//
// The options come from the payload rather than from a constant — the vocabulary is 2,072
// GKG values and this is the head of the ones this name is actually reported under — and each
// carries its count, so a reader can see that picking one narrows a lot or a little before
// they pick it.
export function ThemeFacetFilter({
  value,
  facets,
  onChange,
}: {
  value: string;
  facets: ThemeFacet[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={filterFieldClass(Boolean(value))}>
      Theme{" "}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All themes</option>
        {facets.map(({ theme, articleCount }) => (
          <option key={theme} value={theme}>
            {theme} · {articleCount}
          </option>
        ))}
        {/* A facet arrived at by link may not be in this name's head of the vocabulary. Kept
            as an option so the control states the filter actually in force rather than
            silently reading as "All themes". */}
        {value && !facets.some((facet) => facet.theme === value) && <option value={value}>{value}</option>}
      </select>
    </label>
  );
}

// Sort shares the register's pill, but never its applied state — see
// filterFieldClass. The field and the direction are two controls because they are
// two decisions; `options` differ per page (a Story is first seen, a Brief is
// created, a result is relevant) but the control is one.
export function SortFieldFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-field">
      Sort by{" "}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(({ value: option, label }) => (
          <option key={option} value={option}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

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

// Takes the list envelope whole rather than four loose numbers: the page size is
// what turns "page 2 of 5" into the reader's actual position in the result set,
// and every caller already has the envelope in hand. Derived from the API's own
// list contract so the shape isn't restated here.
export type PaginationEnvelope = Omit<ListEnvelope<unknown>, "items">;

export function Pagination({
  envelope: { page, pageSize, total, totalPages },
  onGoToPage,
}: {
  envelope: PaginationEnvelope;
  onGoToPage: (page: number) => void;
}) {
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="pagination">
      <p>
        Entries {first}–{last} of {total} · Page {page} of {totalPages}
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
