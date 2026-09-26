import type {
  ConditionalFilter,
  CrudFilter,
  CrudSort,
  LogicalFilter,
  MetaQuery,
  Pagination,
} from "@refinedev/core";

const RESERVED_CHARS = /[\s,.:()*"\\]/;

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export function quoteValue(value: string): string {
  if (!RESERVED_CHARS.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatList(value: unknown): string {
  const items = Array.isArray(value) ? value : [value];
  return items
    .filter((item) => item !== null && item !== undefined)
    .map((item) => quoteValue(formatValue(item)))
    .join(",");
}

function likeValue(value: unknown, position: "inner" | "prefix" | "suffix"): string {
  const text = formatValue(value);
  const pattern =
    position === "inner"
      ? `%${text}%`
      : position === "prefix"
        ? `${text}%`
        : `%${text}`;
  return quoteValue(pattern);
}

function fieldCondition(
  field: string,
  operator: string,
  value: unknown,
): string | undefined {
  if (operator === "between" || operator === "nbetween") {
    const [from, to] = Array.isArray(value) ? value : [];
    if (from === undefined || to === undefined) return undefined;
    const start = quoteValue(formatValue(from));
    const end = quoteValue(formatValue(to));
    return operator === "between"
      ? `and(${field}.gte.${start},${field}.lte.${end})`
      : `or(${field}.lt.${start},${field}.gt.${end})`;
  }

  const expression = operatorExpression(operator, value);
  return expression ? `${field}.${expression}` : undefined;
}

function operatorExpression(operator: string, value: unknown): string | undefined {
  switch (operator) {
    case "eq":
      return `eq.${quoteValue(formatValue(value))}`;
    case "ne":
      return `neq.${quoteValue(formatValue(value))}`;
    case "lt":
      return `lt.${quoteValue(formatValue(value))}`;
    case "lte":
      return `lte.${quoteValue(formatValue(value))}`;
    case "gt":
      return `gt.${quoteValue(formatValue(value))}`;
    case "gte":
      return `gte.${quoteValue(formatValue(value))}`;
    case "in":
    case "eqs":
      return `in.(${formatList(value)})`;
    case "nin":
    case "nes":
      return `not.in.(${formatList(value)})`;
    case "ina":
      return `cs.(${formatList(value)})`;
    case "nina":
      return `not.cs.(${formatList(value)})`;
    case "contains":
      return `like.${likeValue(value, "inner")}`;
    case "ncontains":
      return `not.like.${likeValue(value, "inner")}`;
    case "containss":
      return `ilike.${likeValue(value, "inner")}`;
    case "ncontainss":
      return `not.ilike.${likeValue(value, "inner")}`;
    case "startswith":
      return `like.${likeValue(value, "prefix")}`;
    case "nstartswith":
      return `not.like.${likeValue(value, "prefix")}`;
    case "startswiths":
      return `ilike.${likeValue(value, "prefix")}`;
    case "nstartswiths":
      return `not.ilike.${likeValue(value, "prefix")}`;
    case "endswith":
      return `like.${likeValue(value, "suffix")}`;
    case "nendswith":
      return `not.like.${likeValue(value, "suffix")}`;
    case "endswiths":
      return `ilike.${likeValue(value, "suffix")}`;
    case "nendswiths":
      return `not.ilike.${likeValue(value, "suffix")}`;
    case "null":
      return "is.null";
    case "nnull":
      return "not.is.null";
    default:
      return undefined;
  }
}

function isConditionalFilter(filter: CrudFilter): filter is ConditionalFilter {
  const operator = (filter as ConditionalFilter).operator;
  return operator === "or" || operator === "and";
}

function conditionToString(filter: CrudFilter): string | undefined {
  if (isConditionalFilter(filter)) {
    const parts = filter.value
      .map((child) => conditionToString(child))
      .filter(isString);
    return parts.length > 0 ? `${filter.operator}(${parts.join(",")})` : undefined;
  }

  const logical = filter as LogicalFilter;
  if (!isString(logical.field)) return undefined;
  return fieldCondition(logical.field, logical.operator, logical.value);
}

/**
 * Menyusun seluruh filter Refine ke satu query param `and=(...)`
 * ala PostgREST. Top-level memakai `and=(...)`, kondisi di dalamnya
 * memakai bentuk `field.operator.value` dan grup bersarang `or(...)` / `and(...)`.
 */
export function buildFilterParam(filters?: CrudFilter[]): string | undefined {
  const parts = (filters ?? [])
    .map((filter) => conditionToString(filter))
    .filter(isString);
  return parts.length > 0 ? `(${parts.join(",")})` : undefined;
}

export function buildOrderParam(sorters?: CrudSort[]): string | undefined {
  const parts = (sorters ?? [])
    .filter((sorter) => sorter.order === "asc" || sorter.order === "desc")
    .map((sorter) => `${quoteValue(sorter.field)}.${sorter.order}`);
  return parts.length > 0 ? parts.join(",") : undefined;
}

export function buildPaginationParams(
  pagination?: Pagination,
): { limit?: number; offset?: number } {
  if (!pagination || pagination.mode === "client" || pagination.mode === "off") {
    return {};
  }
  const pageSize = pagination.pageSize ?? 10;
  const currentPage = pagination.currentPage ?? 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return {};
  const offset = Math.max(0, (Number(currentPage) - 1) * pageSize);
  return { limit: pageSize, offset };
}

export function resolvePrimaryKey(meta?: MetaQuery): string {
  const primaryKey = meta?.primaryKey;
  return isString(primaryKey) ? primaryKey : "id";
}

export function resolveSelect(meta?: MetaQuery): string {
  const select = meta?.select ?? meta?.query?.select;
  if (isString(select)) return select;
  if (Array.isArray(select)) {
    const columns = select.filter(isString);
    if (columns.length > 0) return columns.join(",");
  }
  return "*";
}

export function buildIdFilter(id: unknown): string {
  return `eq.${quoteValue(String(id))}`;
}

export function buildIdsFilter(ids: readonly unknown[]): string {
  if (ids.length === 0) return "is.null";
  return `in.(${ids.map((id) => quoteValue(String(id))).join(",")})`;
}
