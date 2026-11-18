"use client";

import { CircleAlert, CircleCheck, Copy, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { useLocale, useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { formatDate } from "@/lib/format";
import { DEFAULT_LOCALE, HTML_LANG, LOCALE_NAMES } from "@/lib/locale";
import { formatPhone } from "@/lib/phone";

import type { PreviewRow, RowStatus } from "../rows";

const STATUS_STYLE: Record<RowStatus, { icon: LucideIcon; className: string }> =
  {
    new: {
      icon: CircleCheck,
      className: "bg-status-active text-status-active-foreground",
    },
    duplicate: {
      icon: Copy,
      className: "bg-status-none text-status-none-foreground",
    },
    error: {
      icon: CircleAlert,
      className: "bg-status-expired text-status-expired-foreground",
    },
  };

type Filter = "all" | RowStatus;
const FILTERS: readonly Filter[] = ["all", "new", "duplicate", "error"];

function RowBadge({ status }: { status: RowStatus }) {
  const t = useText("import");
  const { icon: Icon, className } = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      <Icon aria-hidden className="size-3.5" />
      {t.row.status[status]}
    </span>
  );
}

function RowItem({ row, today }: { row: PreviewRow; today: Date }) {
  const t = useText("import");
  const locale = useLocale();
  const name = [row.lastName, row.firstName].filter(Boolean).join(" ");
  return (
    <li
      className="flex flex-col gap-1 px-4 py-3 text-sm"
      data-testid="import-row"
      data-status={row.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium break-words">{name || "—"}</span>
        <RowBadge status={row.status} />
      </div>
      <p className="text-muted-foreground">
        {fmt(t.row.line, { line: row.line })}
        {" · "}
        <span className="tabular-nums">
          {row.phone ? formatPhone(row.phone) : "—"}
        </span>
        {" · "}
        {row.groupName || t.row.noGroup}
        {" · "}
        <span className="tabular-nums">
          {row.endsOn
            ? fmt(t.row.endsOn, {
                date: formatDate(row.endsOn, today, locale),
              })
            : t.row.noDate}
        </span>
        {row.parentStatus === "none" ? null : (
          <>
            {" · "}
            <span data-testid="import-row-parent">
              {row.parentName} (
              {row.parentStatus === "found"
                ? t.row.parentFound
                : t.row.parentNew}
              )
            </span>
          </>
        )}
        {row.messageLocale === DEFAULT_LOCALE ? null : (
          <>
            {" · "}
            <span lang={HTML_LANG[row.messageLocale]}>
              {LOCALE_NAMES[row.messageLocale]}
            </span>
          </>
        )}
      </p>
      {row.status === "error" ? (
        <ul className="flex flex-col text-destructive">
          {row.errors.map((error) => (
            <li key={error}>{t.row.errors[error]}</li>
          ))}
        </ul>
      ) : null}
      {row.status === "duplicate" ? (
        <p className="text-muted-foreground">
          {row.duplicateOf === null
            ? t.row.onFile
            : fmt(t.row.repeatOf, { line: row.duplicateOf })}
        </p>
      ) : null}
      {row.status === "new" && row.groupName !== "" && row.groupId === null ? (
        <p className="text-status-expiring-foreground">
          {fmt(t.row.groupMissing, { name: row.groupName })}
        </p>
      ) : null}
    </li>
  );
}

/** Every row of the file with its status, filterable; errors are explained next to the row. */
export function PreviewRows({
  rows,
  counts,
  today,
}: {
  rows: readonly PreviewRow[];
  counts: Record<RowStatus, number>;
  today: Date;
}) {
  const t = useText("import");
  const [filter, setFilter] = useState<Filter>(
    counts.error > 0 ? "error" : "all",
  );
  const shown =
    filter === "all" ? rows : rows.filter((row) => row.status === filter);
  const count = (key: Filter) => (key === "all" ? rows.length : counts[key]);
  return (
    <section aria-labelledby="import-rows" className="flex flex-col gap-3">
      <h2 id="import-rows" className="sr-only">
        {t.filter.label}
      </h2>
      <div
        role="group"
        aria-label={t.filter.label}
        className="flex flex-wrap gap-2"
      >
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            {t.filter[key]}
            <span className="tabular-nums">{count(key)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t.filter.empty}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {shown.map((row) => (
            <RowItem key={row.line} row={row} today={today} />
          ))}
        </ul>
      )}
    </section>
  );
}
