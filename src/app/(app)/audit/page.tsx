import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { AuditEntryItem } from "@/features/audit/components/audit-entry-item";
import { AuditFilters } from "@/features/audit/components/audit-filters";
import {
  type AuditQuery,
  auditQueryFromParams,
  encodeCursor,
} from "@/features/audit/schema";
import { getAuditFeed } from "@/features/audit/service";
import { requireStaff } from "@/features/auth/require-staff";
import { buttonVariants } from "@/components/ui/variants";
import { auditText as t } from "@/i18n/audit";
import { ru } from "@/i18n/ru";

export const metadata: Metadata = {
  title: `${ru.pages.audit} | ${ru.app.name}`,
};

/** The address of a page of the journal with the same filter. */
function pageHref(query: AuditQuery, cursor: string | null): string {
  const params = new URLSearchParams();
  if (query.staff) params.set("staff", query.staff);
  if (query.action) params.set("action", query.action);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (cursor) params.set("cursor", cursor);
  const search = params.toString();
  return search ? `/audit?${search}` : "/audit";
}

/**
 * Owner only. Two database requests: the role check and audit_feed(), which returns one page and
 * the employees for the filter. Filter and page live in the address (GET form, cursor links), so
 * the screen ships no client code of its own.
 */
export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requireStaff(["owner"]);
  const now = new Date();
  const { query, invalid } = auditQueryFromParams(await searchParams);
  const feed = await getAuditFeed(await createServerDb(), query);
  const filtered = Boolean(
    query.staff || query.action || query.from || query.to,
  );
  const last = feed.entries.at(-1);

  return (
    <>
      <PageHeader title={ru.pages.audit} description={t.description} />
      <AuditFilters query={query} staff={feed.staff} filtered={filtered} />
      {invalid ? (
        <p role="status" className="text-sm text-status-expired-foreground">
          {t.filters.invalid}
        </p>
      ) : null}
      {feed.entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t.empty}
          description={filtered ? t.emptyFiltered : undefined}
        />
      ) : (
        <ol
          className="flex flex-col divide-y rounded-xl border bg-card"
          data-testid="audit-list"
        >
          {feed.entries.map((entry) => (
            <AuditEntryItem key={entry.id} entry={entry} now={now} />
          ))}
        </ol>
      )}
      {query.cursor || (feed.hasMore && last) ? (
        <nav
          aria-label={ru.pages.audit}
          className="flex flex-wrap justify-between gap-2"
        >
          {query.cursor ? (
            <Link
              href={pageHref({ ...query, cursor: undefined }, null)}
              className={buttonVariants({ variant: "outline" })}
            >
              <ChevronLeft aria-hidden />
              {t.first}
            </Link>
          ) : (
            <span />
          )}
          {feed.hasMore && last ? (
            <Link
              href={pageHref(query, encodeCursor(last))}
              className={buttonVariants({ variant: "outline" })}
              data-testid="audit-next"
            >
              {t.next}
              <ChevronRight aria-hidden />
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
