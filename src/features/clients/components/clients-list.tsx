"use client";

import { ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import {
  lazy,
  type ReactNode,
  Suspense,
  useDeferredValue,
  useId,
  useMemo,
  useOptimistic,
  useState,
} from "react";

import { DateText } from "@/components/date-text";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import type {
  CancelPayment,
  PaymentTarget,
  RecordPayment,
} from "@/features/payments/components/payment-dialog";
import { useLocale, useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";

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

// The payment dialog, its texts and the toasts load on first intent: the list stays within budget.
const loadPaymentDialog = () =>
  import("@/features/payments/components/payment-dialog");
const PaymentDialog = lazy(loadPaymentDialog);

type Paid = { clientId: string; endsOn: string };

/**
 * Shown while the payment request runs and replaced by the server's rows when it succeeds (React
 * drops it on failure). A new month always leaves more than 7 days, so "active" is what
 * client_status() will report; the status itself is still computed only in the database.
 */
function withPaid(rows: ClientRow[], paid: Paid): ClientRow[] {
  return rows.map((row) =>
    row.id === paid.clientId
      ? { ...row, status: "active", endsOn: paid.endsOn }
      : row,
  );
}

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
  recordPayment,
  cancelPayment,
}: {
  rows: ClientRow[];
  groups: GroupOption[];
  coaches: Coach[];
  initialFilters: ClientFilters;
  today: Date;
  recordPayment: RecordPayment;
  cancelPayment: CancelPayment;
}) {
  const l = useText("clientsList");
  const statusText = useText("status");
  const [shownRows, markPaid] = useOptimistic(rows, withPaid);
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(initialFilters);
  // Typing stays responsive; the list catches up a frame later on a slow phone.
  const deferredQuery = useDeferredValue(query);
  const ids = useId();

  const indexed = useMemo(() => indexRows(shownRows), [shownRows]);
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
              {statusText[status]}
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
          {fmt(l.found, { count: visible.length })}
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
              onPay={(group) => {
                setPayTarget({
                  clientId: row.id,
                  name: `${row.lastName} ${row.firstName}`,
                  endsOn: row.endsOn,
                  price: group && !group.archived ? group.price : null,
                });
                setPayOpen(true);
              }}
            />
          ))}
        </ul>
      )}
      {payTarget ? (
        <Suspense fallback={null}>
          <PaymentDialog
            // One form (and one idempotency key) per client.
            key={payTarget.clientId}
            target={payTarget}
            today={today}
            open={payOpen}
            onOpenChange={setPayOpen}
            record={recordPayment}
            cancel={cancelPayment}
            onOptimistic={(endsOn) =>
              markPaid({ clientId: payTarget.clientId, endsOn })
            }
          />
        </Suspense>
      ) : null}
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

function groupLabel(
  l: Messages["clientsList"],
  group: GroupOption | undefined,
): string {
  if (!group) return l.noGroup;
  return group.archived ? `${group.name} (${l.archivedGroup})` : group.name;
}

function ClientListRow({
  row,
  group,
  today,
  onPay,
}: {
  row: ClientRow;
  group: GroupOption | undefined;
  today: Date;
  onPay: (group: GroupOption | undefined) => void;
}) {
  const l = useText("clientsList");
  const statusText = useText("status");
  const name = `${row.lastName} ${row.firstName}`;
  return (
    <li data-testid="client-row" className="flex items-center gap-2 pr-3">
      {/* No prefetch: hundreds of rows scroll past while searching, and the list stays offline. */}
      <Link
        href={`/clients/${row.id}`}
        prefetch={false}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3 pl-4 outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="grid min-w-0 flex-1 gap-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_9rem_10rem] md:items-center md:gap-4">
          <span className="font-medium break-words">{name}</span>
          {/* Phone: status and end date first and never cut; the line wraps before they would be. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground md:contents">
            <span className="md:hidden">
              <StatusBadge status={row.status} label={statusText[row.status]} />
            </span>
            <span className="shrink-0 whitespace-nowrap md:order-1">
              <EndsOn row={row} today={today} />
            </span>
            <span aria-hidden className="md:hidden">
              ·
            </span>
            <span className="max-w-full truncate">{groupLabel(l, group)}</span>
          </span>
          <span className="hidden md:order-2 md:flex md:justify-end">
            <StatusBadge status={row.status} label={statusText[row.status]} />
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="hidden size-4 shrink-0 text-muted-foreground md:block"
        />
      </Link>
      <button
        type="button"
        aria-label={fmt(l.payFor, { name })}
        className={buttonVariants({ variant: "outline" })}
        onPointerEnter={() => void loadPaymentDialog()}
        onFocus={() => void loadPaymentDialog()}
        onClick={() => onPay(group)}
        data-testid="row-pay"
      >
        {l.pay}
      </button>
    </li>
  );
}

function EndsOn({ row, today }: { row: ClientRow; today: Date }) {
  const l = useText("clientsList");
  const locale = useLocale();
  if (!row.endsOn) return <>{l.noSubscription}</>;
  return (
    <>
      {l.endsOnPrefix}{" "}
      <DateText date={row.endsOn} today={today} locale={locale} />
    </>
  );
}
