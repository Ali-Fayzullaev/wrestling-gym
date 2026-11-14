"use client";

import { ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useDeferredValue,
  useId,
  useMemo,
  useState,
} from "react";

import { DateText } from "@/components/date-text";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { clientsListText as l } from "@/i18n/clients-list";
import { ru } from "@/i18n/ru";

import {
  type ClientFilters,
  type ClientRow,
  DEFAULT_FILTERS,
  filtersToSearch,
  type GroupOption,
  hasActiveFilters,
  indexRows,
  NO_ACTIVE_GROUP,
  STATUSES,
  visibleRows,
} from "../filters";
import type { Coach } from "../service";

/**
 * The whole list arrives once from the server; search, filters and sorting run here without any
 * request. Filters go to the URL (replaceState: no navigation, no server round trip) so a link can
 * be shared. The search text stays in memory only: it may be a name or a phone number.
 */
export function ClientsList({
  rows,
  groups,
  coaches,
  initialFilters,
  today,
}: {
  rows: ClientRow[];
  groups: GroupOption[];
  coaches: Coach[];
  initialFilters: ClientFilters;
  today: Date;
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(initialFilters);
  // Typing stays responsive; the list catches up a frame later on a slow phone.
  const deferredQuery = useDeferredValue(query);
  const ids = useId();

  const indexed = useMemo(() => indexRows(rows), [rows]);
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const visible = useMemo(
    () => visibleRows(indexed, filters, groupsById, deferredQuery),
    [indexed, filters, groupsById, deferredQuery],
  );

  function update(next: ClientFilters) {
    setFilters(next);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${filtersToSearch(next)}`,
    );
  }
  const set = <K extends keyof ClientFilters>(
    key: K,
    value: ClientFilters[K],
  ) => update({ ...filters, [key]: value });

  const activeGroups = groups.filter((group) => !group.archived);
  const filtered = hasActiveFilters(filters) || query.trim() !== "";

  return (
    <div className="flex flex-col gap-3">
      <div role="search" className="relative">
        <label htmlFor={`${ids}-q`} className="sr-only">
          {l.search}
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          id={`${ids}-q`}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={l.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={`${inputClassName} pr-11 pl-9 [&::-webkit-search-cancel-button]:hidden`}
        />
        {query ? (
          <button
            type="button"
            aria-label={l.clearSearch}
            onClick={() => setQuery("")}
            className={`${buttonVariants({ variant: "ghost", size: "icon" })} absolute top-0 right-0`}
          >
            <X aria-hidden />
          </button>
        ) : null}
      </div>

      <fieldset className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <legend className="sr-only">{l.filters}</legend>
        <FilterSelect
          id={`${ids}-group`}
          label={l.group}
          value={filters.group ?? ""}
          onChange={(value) => set("group", value || null)}
        >
          <option value="">{l.allGroups}</option>
          {activeGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
          <option value={NO_ACTIVE_GROUP}>{l.noActiveGroup}</option>
        </FilterSelect>
        <FilterSelect
          id={`${ids}-status`}
          label={l.status}
          value={filters.status ?? ""}
          onChange={(value) =>
            set("status", STATUSES.find((status) => status === value) ?? null)
          }
        >
          <option value="">{l.allStatuses}</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {ru.status[status]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          id={`${ids}-coach`}
          label={l.coach}
          value={filters.coach ?? ""}
          onChange={(value) => set("coach", value || null)}
        >
          <option value="">{l.allCoaches}</option>
          {coaches.map((coach) => (
            <option key={coach.id} value={coach.id}>
              {coach.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          id={`${ids}-archive`}
          label={l.archive}
          value={filters.archived ? "1" : ""}
          onChange={(value) => set("archived", value === "1")}
        >
          <option value="">{l.archiveOff}</option>
          <option value="1">{l.archiveOn}</option>
        </FilterSelect>
        <FilterSelect
          id={`${ids}-sort`}
          label={l.sort}
          value={filters.sort}
          active={filters.sort !== "name"}
          onChange={(value) => set("sort", value === "ends" ? "ends" : "name")}
          className="col-span-2 md:col-span-1"
        >
          <option value="name">{l.sortName}</option>
          <option value="ends">{l.sortEnds}</option>
        </FilterSelect>
      </fieldset>

      <div className="flex min-h-11 items-center justify-between gap-3">
        <p
          className="text-sm text-muted-foreground"
          aria-live="polite"
          data-testid="clients-found"
        >
          {l.found(visible.length)}
        </p>
        {filtered ? (
          <button
            type="button"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            onClick={() => {
              setQuery("");
              update({ ...DEFAULT_FILTERS, sort: filters.sort });
            }}
          >
            {l.reset}
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-8 text-center">
          <p className="font-medium">{l.nothingFound}</p>
          <p className="text-sm text-muted-foreground">{l.nothingFoundHint}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {visible.map((row) => (
            <ClientListRow
              key={row.id}
              row={row}
              group={row.groupId ? groupsById.get(row.groupId) : undefined}
              today={today}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  active = value !== "",
  onChange,
  className = "",
  children,
}: {
  id: string;
  label: string;
  value: string;
  /** Marked when it narrows the list (or changes its order). */
  active?: boolean;
  onChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClassName} ${active ? "border-primary" : ""}`}
      >
        {children}
      </select>
    </div>
  );
}

function groupLabel(group: GroupOption | undefined): string {
  if (!group) return l.noGroup;
  return group.archived ? `${group.name} (${l.archivedGroup})` : group.name;
}

function ClientListRow({
  row,
  group,
  today,
}: {
  row: ClientRow;
  group: GroupOption | undefined;
  today: Date;
}) {
  return (
    <li data-testid="client-row">
      {/* No prefetch: hundreds of rows scroll past while searching, and the list stays offline. */}
      <Link
        href={`/clients/${row.id}`}
        prefetch={false}
        className="flex min-h-16 items-center gap-3 px-4 py-3 outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="grid min-w-0 flex-1 gap-0.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_9rem_10rem] md:items-center md:gap-4">
          <span className="font-medium break-words">
            {row.lastName} {row.firstName}
          </span>
          {/* Phone: the end date first, it matters more than the group and must not be cut. */}
          <span className="flex min-w-0 gap-1 text-sm text-muted-foreground md:contents">
            <span className="shrink-0 whitespace-nowrap md:order-1">
              <EndsOn row={row} today={today} />
            </span>
            <span aria-hidden className="md:hidden">
              ·
            </span>
            <span className="truncate">{groupLabel(group)}</span>
          </span>
          <span className="hidden md:order-2 md:flex md:justify-end">
            <StatusBadge status={row.status} />
          </span>
        </span>
        <span className="md:hidden">
          <StatusBadge status={row.status} />
        </span>
        <ChevronRight
          aria-hidden
          className="hidden size-4 shrink-0 text-muted-foreground sm:block"
        />
      </Link>
    </li>
  );
}

function EndsOn({ row, today }: { row: ClientRow; today: Date }) {
  if (!row.endsOn) return <>{l.noSubscription}</>;
  return (
    <>
      {l.endsOnPrefix} <DateText date={row.endsOn} today={today} />
    </>
  );
}
