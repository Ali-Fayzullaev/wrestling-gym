import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { BarList } from "@/features/reports/components/bar-list";
import { DebtorsList } from "@/features/reports/components/debtors-list";
import { ExportLinks } from "@/features/reports/components/export-links";
import { MonthNav } from "@/features/reports/components/month-nav";
import { currentMonth, parseMonth } from "@/features/reports/month";
import { getMonthReport } from "@/features/reports/service";
import { plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.reports} | ${t.app.name}` };
}

/**
 * Owner only. Two database requests: the role check and report_month(), which counts everything
 * in Postgres. The month is in the address (?month=YYYY-MM); the screen has no client code.
 */
export default async function ReportsPage({
  searchParams,
}: PageProps<"/reports">) {
  const { t: messages, locale } = await getI18n();
  const t = messages.reports;
  await requireStaff(["owner"]);
  const now = new Date();
  const params = await searchParams;
  const month = parseMonth(params.month, now);
  const report = await getMonthReport(await createServerDb(), now, month);
  const debtorsCount = report.debtors.reduce((sum, g) => sum + g.count, 0);
  const debtorsExpected = report.debtors.reduce(
    (sum, g) => sum + g.expected,
    0,
  );

  return (
    <>
      <PageHeader
        title={messages.pages.reports}
        mascot="champion"
        actions={<MonthNav month={month} current={currentMonth(now)} />}
      />

      <section aria-label={t.total.title} className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-xl border border-l-4 border-l-primary bg-card p-4">
          <h2 className="text-sm text-muted-foreground">{t.total.title}</h2>
          <Money
            locale={locale}
            amount={report.total.amount}
            className="text-3xl font-semibold"
          />
          <p
            className="text-sm text-muted-foreground tabular-nums"
            data-testid="report-total-count"
          >
            {plural(locale, t.total.count, report.total.count)}
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
          <h2 className="text-sm text-muted-foreground">
            {t.total.reversedTitle}
          </h2>
          <Money
            locale={locale}
            amount={report.reversed.amount}
            className="text-xl font-semibold"
          />
          <p className="text-sm text-muted-foreground">
            {plural(locale, t.total.count, report.reversed.count)}.{" "}
            {t.total.reversedHint}
          </p>
        </div>
      </section>

      {report.total.count === 0 ? (
        <EmptyState
          mood="search"
          title={t.emptyTitle}
          description={t.emptyText}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <BarList
            title={t.byMethod.title}
            testId="report-by-method"
            countLabel={(count) => plural(locale, t.total.count, count)}
            bars={report.byMethod.map((row) => ({
              key: row.method,
              label: t.byMethod.methods[row.method],
              amount: row.amount,
              count: row.count,
            }))}
          />
          <BarList
            title={t.byGroup.title}
            hint={t.byGroup.hint}
            testId="report-by-group"
            countLabel={(count) => plural(locale, t.total.count, count)}
            bars={report.byGroup.map((row) => ({
              key: row.groupId ?? "none",
              label: row.name ?? t.noGroup,
              amount: row.amount,
              count: row.count,
            }))}
          />
        </div>
      )}

      <section aria-labelledby="debtors-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 id="debtors-title" className="text-lg font-semibold">
              {t.debtors.title}
            </h2>
            <p className="text-sm text-muted-foreground">{t.debtors.hint}</p>
          </div>
          {debtorsCount > 0 ? (
            <p className="text-sm" data-testid="debtors-total">
              <span className="text-muted-foreground">
                {plural(locale, t.debtors.count, debtorsCount)},{" "}
                {t.debtors.total}:{" "}
              </span>
              <Money
                locale={locale}
                amount={debtorsExpected}
                className="font-semibold"
              />
            </p>
          ) : null}
        </div>
        {report.debtors.length === 0 ? (
          <EmptyState
            mood="champion"
            title={t.debtors.emptyTitle}
            description={t.debtors.emptyText}
          />
        ) : (
          <DebtorsList groups={report.debtors} today={now} />
        )}
      </section>

      <ExportLinks month={month} />
    </>
  );
}
