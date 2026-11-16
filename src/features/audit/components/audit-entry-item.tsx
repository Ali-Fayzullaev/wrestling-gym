import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { getI18n } from "@/i18n/server";
import { formatDate, formatTime } from "@/lib/format";

import { type AuditEntry, describeAuditEntry } from "../describe";

/** One journal line: when, who, what in plain words, the details and a link to the record. */
export async function AuditEntryItem({
  entry,
  now,
}: {
  entry: AuditEntry;
  now: Date;
}) {
  const i18n = await getI18n();
  const t = i18n.t.audit;
  const { title, details, target } = describeAuditEntry(i18n, entry, now);
  const at = new Date(entry.createdAt);
  return (
    <li
      className="flex flex-col gap-1.5 px-4 py-3"
      data-testid="audit-entry"
      data-action={entry.action}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="font-semibold" data-testid="audit-title">
          {title}
        </p>
        <time
          dateTime={entry.createdAt}
          className="text-sm text-muted-foreground tabular-nums"
        >
          {`${formatDate(at, now, i18n.locale)}, ${formatTime(at)}`}
        </time>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="audit-actor">
        {entry.actorName ?? t.system}
      </p>
      {details.length > 0 ? (
        <p className="text-sm" data-testid="audit-details">
          {details.join(" · ")}
        </p>
      ) : null}
      {target ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{`${target.label}: `}</span>
          {target.href ? (
            <Link
              href={target.href}
              aria-label={`${target.linkLabel ?? target.label}: ${target.name}`}
              className="inline-flex min-h-11 items-center gap-0.5 font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring md:min-h-0"
            >
              {target.name}
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <span>{target.name}</span>
          )}
        </p>
      ) : null}
    </li>
  );
}
