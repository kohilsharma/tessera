import { SelectQueryBuilder } from "typeorm";

export type SortDir = "asc" | "desc";

export type ParsedListQuery = {
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: SortDir;
  category?: string;
  from?: Date;
  to?: Date;
};

export type ListQueryOptions = {
  allowedSortBy: readonly string[];
  defaultSortBy: string;
  allowedCategories?: readonly string[];
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

function parsePositiveInt(value: unknown, fallback: number, errors: string[], field: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    errors.push(`${field} must be a positive integer`);
    return fallback;
  }
  return n;
}

function parseDate(value: unknown, errors: string[], field: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    errors.push(`${field} must be a valid date`);
    return undefined;
  }
  return date;
}

// Shared filter+sort+pagination contract for every paginated list endpoint —
// Stories here, IntelligenceBrief list (#20) and hybrid search (#22) reuse it —
// so the query-param shape and validation stay identical across all three.
export function parseListQuery(
  query: Record<string, unknown>,
  options: ListQueryOptions,
): { ok: true; value: ParsedListQuery } | { ok: false; error: string } {
  const errors: string[] = [];

  const page = parsePositiveInt(query.page, 1, errors, "page");
  const pageSize = parsePositiveInt(query.pageSize, DEFAULT_PAGE_SIZE, errors, "pageSize");
  if (pageSize > MAX_PAGE_SIZE) errors.push(`pageSize must be at most ${MAX_PAGE_SIZE}`);

  const sortBy = query.sortBy === undefined ? options.defaultSortBy : String(query.sortBy);
  if (!options.allowedSortBy.includes(sortBy)) {
    errors.push(`sortBy must be one of: ${options.allowedSortBy.join(", ")}`);
  }

  let sortDir: SortDir = "desc";
  if (query.sortDir !== undefined) {
    if (query.sortDir !== "asc" && query.sortDir !== "desc") errors.push("sortDir must be 'asc' or 'desc'");
    else sortDir = query.sortDir;
  }

  let category: string | undefined;
  if (query.category !== undefined) {
    if (typeof query.category !== "string" || !options.allowedCategories?.includes(query.category)) {
      errors.push(`category must be one of: ${options.allowedCategories?.join(", ") ?? "(none configured)"}`);
    } else {
      category = query.category;
    }
  }

  const from = parseDate(query.from, errors, "from");
  const to = parseDate(query.to, errors, "to");

  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  return { ok: true, value: { page, pageSize, sortBy, sortDir, category, from, to } };
}

export async function paginate<T extends object>(
  qb: SelectQueryBuilder<T>,
  page: number,
  pageSize: number,
): Promise<{ items: T[]; total: number }> {
  const [items, total] = await qb
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getManyAndCount();
  return { items, total };
}

export function toEnvelope<T>(items: T[], page: number, pageSize: number, total: number): ListEnvelope<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
