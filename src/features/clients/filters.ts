// Filters and sorting of the clients list. They run in the browser over the list the server sent
// once, so this file stays free of Zod and server code. Filters live in the URL so a link can be
// shared; the search text never does (it may be a name or a phone).

import type { SubscriptionStatus } from "@/components/status-badge";
import {
  isEmptyQuery,
  matchesQuery,
  parseQuery,
  type Searchable,
  toSearchable,
} from "@/lib/search";

export const STATUSES = ["active", "expiring", "expired", "none"] as const;

/** Group filter value for clients without an active group (none, or an archived one). */
export const NO_ACTIVE_GROUP = "none";

export type SortKey = "name" | "ends";

export type ClientFilters = {
  /** A group id, NO_ACTIVE_GROUP, or null for all. */
  group: string | null;
  status: SubscriptionStatus | null;
  /** Coach of the client's active group. */
  coach: string | null;
  /** false: current clients only (default); true: archived clients only. */
  archived: boolean;
  sort: SortKey;
};

export const DEFAULT_FILTERS: ClientFilters = {
  group: null,
  status: null,
  coach: null,
  archived: false,
  sort: "name",
};

export type ClientRow = {
  id: string;
  lastName: string;
  firstName: string;
  phone: string;
  groupId: string | null;
  archived: boolean;
  status: SubscriptionStatus;
  /** YYYY-MM-DD, null without any payment. */
  endsOn: string | null;
};

export type GroupOption = {
  id: string;
  name: string;
  coachId: string;
  archived: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Record<string, string | string[] | undefined>;

function single(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function isStatus(value: string | undefined): value is SubscriptionStatus {
  return (STATUSES as readonly (string | undefined)[]).includes(value);
}

/** Reads filters from the URL; anything unknown or malformed falls back to the default. */
export function parseFilters(params: Params): ClientFilters {
  const group = single(params, "group");
  const status = single(params, "status");
  const coach = single(params, "coach");
  return {
    group:
      group === NO_ACTIVE_GROUP || (group && UUID.test(group))
        ? group.toLowerCase()
        : null,
    status: isStatus(status) ? status : null,
    coach: coach && UUID.test(coach) ? coach.toLowerCase() : null,
    archived: single(params, "archive") === "1",
    sort: single(params, "sort") === "ends" ? "ends" : "name",
  };
}

/** The query string for the filters ("" for the defaults); ids and fixed words only. */
export function filtersToSearch(filters: ClientFilters): string {
  const params = new URLSearchParams();
  if (filters.group) params.set("group", filters.group);
  if (filters.status) params.set("status", filters.status);
  if (filters.coach) params.set("coach", filters.coach);
  if (filters.archived) params.set("archive", "1");
  if (filters.sort !== "name") params.set("sort", filters.sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function hasActiveFilters(filters: ClientFilters): boolean {
  return (
    filters.group !== null ||
    filters.status !== null ||
    filters.coach !== null ||
    filters.archived
  );
}

export type IndexedRow = ClientRow & { search: Searchable };

/** Folds names and phones once, not on every keystroke. */
export function indexRows(rows: ClientRow[]): IndexedRow[] {
  return rows.map((row) => ({
    ...row,
    search: toSearchable(`${row.lastName} ${row.firstName}`, row.phone),
  }));
}

function matchesFilters(
  row: ClientRow,
  filters: ClientFilters,
  groups: ReadonlyMap<string, GroupOption>,
): boolean {
  if (row.archived !== filters.archived) return false;
  if (filters.status && row.status !== filters.status) return false;
  const group = row.groupId ? groups.get(row.groupId) : undefined;
  const activeGroup = group && !group.archived ? group : undefined;
  if (filters.group === NO_ACTIVE_GROUP) {
    if (activeGroup) return false;
  } else if (filters.group && row.groupId !== filters.group) return false;
  if (filters.coach && activeGroup?.coachId !== filters.coach) return false;
  return true;
}

const collator = new Intl.Collator("ru", { sensitivity: "base" });

function byName(a: ClientRow, b: ClientRow): number {
  return (
    collator.compare(a.lastName, b.lastName) ||
    collator.compare(a.firstName, b.firstName) ||
    a.id.localeCompare(b.id)
  );
}

/** Soonest end first (debts at the top); never paid at the end. */
function byEndsOn(a: ClientRow, b: ClientRow): number {
  if (a.endsOn !== b.endsOn) {
    if (a.endsOn === null) return 1;
    if (b.endsOn === null) return -1;
    return a.endsOn < b.endsOn ? -1 : 1;
  }
  return byName(a, b);
}

/** The rows to show: filters, then the search text, then the chosen order. */
export function visibleRows<T extends IndexedRow>(
  rows: readonly T[],
  filters: ClientFilters,
  groups: ReadonlyMap<string, GroupOption>,
  query: string,
): T[] {
  const parsed = parseQuery(query);
  const searching = !isEmptyQuery(parsed);
  return rows
    .filter(
      (row) =>
        matchesFilters(row, filters, groups) &&
        (!searching || matchesQuery(row.search, parsed)),
    )
    .sort(filters.sort === "ends" ? byEndsOn : byName);
}
