import { SelectQueryBuilder } from "typeorm";

export type SortDir = "asc" | "desc";

// Generic over the sort field so a caller's `allowedSortBy` literal is the
// single source of truth for both the runtime check and the returned type —
// otherwise every caller re-asserts the union with a cast the validator has
// already earned.
export type ParsedListQuery<TSort extends string = string> = {
  page: number;
  pageSize: number;
  sortBy: TSort;
  sortDir: SortDir;
  category?: string;
  dateFrom?: Date;
  dateTo?: Date;
};

export type ListQueryOptions<TSort extends string> = {
  allowedSortBy: readonly TSort[];
  defaultSortBy: NoInfer<TSort>;
  allowedCategories?: readonly string[];
  // Raised where an endpoint answers with a *set* rather than a page of one — the search
  // timeline's axis holds up to its own cap (#65). Declared here, beside the other
  // per-endpoint differences, so the bound a route validates against is the bound its own
  // reads obey: a value written past the parse would put the ceiling in two places.
  maxPageSize?: number;
};

export type ListEnvelope<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parsePositiveInt(value: unknown, fallback: number, errors: string[], field: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    errors.push(`${field} must be a positive integer`);
    return fallback;
  }
  return n;
}

// `endOfDay` matters for the inclusive upper bound: <input type="date"> sends
// "2026-01-04", which parses to midnight UTC, so a plain `<=` would drop
// everything published later that same day under a UI that says "to 4 Jan".
// A caller passing a full timestamp gets it honoured as given.
function parseDate(value: unknown, errors: string[], field: string, endOfDay = false): Date | undefined {
  if (value === undefined) return undefined;
  const raw = String(value);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    errors.push(`${field} must be a valid date`);
    return undefined;
  }
  if (endOfDay && DATE_ONLY.test(raw)) date.setUTCHours(23, 59, 59, 999);
  return date;
}

// Shared filter+sort+pagination contract for every paginated list endpoint —
// Stories here, IntelligenceBrief list (#20) and hybrid search (#22) reuse it —
// so the query-param shape and validation stay identical across all three. Where an
// endpoint differs it says so in `options` and nowhere else, which is why the page-size
// ceiling is one of them: a route that reads more than a page still validates the number
// it reads with.
// Param names are the parent spec's API contract: `category`, `dateFrom`,
// `dateTo`, `sort` (as `field` or `field:asc|desc`), `page`, `pageSize`.
export function parseListQuery<TSort extends string>(
  query: Record<string, unknown>,
  options: ListQueryOptions<TSort>,
): { ok: true; value: ParsedListQuery<TSort> } | { ok: false; error: string } {
  const errors: string[] = [];

  const page = parsePositiveInt(query.page, 1, errors, "page");
  const pageSize = parsePositiveInt(query.pageSize, DEFAULT_PAGE_SIZE, errors, "pageSize");
  const maxPageSize = options.maxPageSize ?? MAX_PAGE_SIZE;
  if (pageSize > maxPageSize) errors.push(`pageSize must be at most ${maxPageSize}`);

  const parts = (query.sort === undefined ? options.defaultSortBy : String(query.sort)).split(":");
  if (parts.length > 2) errors.push("sort must be 'field' or 'field:asc|desc'");
  const sortBy = parts[0] as TSort;
  if (!options.allowedSortBy.includes(sortBy)) {
    errors.push(`sort field must be one of: ${options.allowedSortBy.join(", ")}`);
  }
  let sortDir: SortDir = "desc";
  const rawDir = parts[1] ?? "desc";
  if (rawDir !== "asc" && rawDir !== "desc") errors.push("sort direction must be 'asc' or 'desc'");
  else sortDir = rawDir;

  let category: string | undefined;
  if (query.category !== undefined) {
    if (typeof query.category !== "string" || !options.allowedCategories?.includes(query.category)) {
      errors.push(`category must be one of: ${options.allowedCategories?.join(", ") ?? "(none configured)"}`);
    } else {
      category = query.category;
    }
  }

  const dateFrom = parseDate(query.dateFrom, errors, "dateFrom");
  const dateTo = parseDate(query.dateTo, errors, "dateTo", true);
  if (dateFrom && dateTo && dateFrom > dateTo) errors.push("dateFrom must not be after dateTo");

  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  return { ok: true, value: { page, pageSize, sortBy, sortDir, category, dateFrom, dateTo } };
}

export async function paginate<T extends object>(
  qb: SelectQueryBuilder<T>,
  page: number,
  pageSize: number,
): Promise<{ items: T[]; total: number }> {
  // Primary-key tiebreaker, appended after the caller's sort: Postgres promises
  // no order between rows tied on the sort column, so without this a tie can
  // repeat a row on one page and drop another entirely. Every entity behind a
  // paginated list here has a uuid `id`.
  const [items, total] = await qb
    .addOrderBy(`${qb.alias}.id`, "ASC")
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getManyAndCount();
  return { items, total };
}

export function toEnvelope<T>(items: T[], page: number, pageSize: number, total: number): ListEnvelope<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
